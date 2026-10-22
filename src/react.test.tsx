import { act, type ComponentProps, type ReactElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import NetInfo from '@react-native-community/netinfo';
import { NetworkConsumer, NetworkProvider, useIsConnected } from './react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }).IS_REACT_NATIVE_TEST_ENVIRONMENT =
  true;

jest.mock(
  '@react-native-community/netinfo',
  () => {
    const fetch = jest.fn();
    const addEventListener = jest.fn(() => jest.fn());
    return {
      __esModule: true,
      fetch,
      addEventListener,
      default: { fetch, addEventListener },
    };
  },
  { virtual: true },
);

jest.mock(
  'react-native',
  () => ({
    Platform: { OS: 'ios' },
    AppState: {
      currentState: 'active',
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
  }),
  { virtual: true },
);

const URL_MARKER = 'https://offline.example/ping-url-marker';
const HEADER_NAME = 'X-Marker-Header';
const HEADER_VALUE = 'header-value-marker';
const fetchMock = NetInfo.fetch as jest.Mock;

class FakeXHR {
  static created: FakeXHR[] = [];

  status = 0;
  timeout = 0;
  method = '';
  url = '';
  requestHeaders: Record<string, string> = {};
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string): void {
    FakeXHR.created.push(this);
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  send(): void {}

  abort(): void {
    this.onabort?.();
  }

  respond(status: number): void {
    this.status = status;
    this.onload?.();
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType('span').map((node) => node.children.join(''));
}

describe('NetworkProvider', () => {
  const renderers: ReactTestRenderer[] = [];

  beforeEach(() => {
    FakeXHR.created = [];
    fetchMock.mockReset();
    (globalThis as { XMLHttpRequest: typeof FakeXHR }).XMLHttpRequest = FakeXHR;
  });

  afterEach(() => {
    act(() => {
      renderers.splice(0).forEach((renderer) => renderer.unmount());
    });
    jest.useRealTimers();
  });

  function mount(element: ReactElement): ReactTestRenderer {
    const renderer = TestRenderer.create(element);
    renderers.push(renderer);
    return renderer;
  }

  it('el primer render es null y, con HTTP 204, el hook y el consumer informan acceso', async () => {
    const hookValues: Array<boolean | null> = [];
    const consumerValues: Array<boolean | null> = [];
    let resolveFetch: (state: { isConnected: boolean }) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    function HookStatus() {
      const isConnected = useIsConnected();
      hookValues.push(isConnected);
      return <span>{`hook:${String(isConnected)}`}</span>;
    }

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = mount(
        <NetworkProvider>
          <HookStatus />
          <NetworkConsumer>
            {({ isConnected }) => {
              consumerValues.push(isConnected);
              return <span>{`consumer:${String(isConnected)}`}</span>;
            }}
          </NetworkConsumer>
        </NetworkProvider>,
      );
    });

    expect(hookValues[0]).toBeNull();
    expect(consumerValues[0]).toBeNull();
    expect(texts(renderer)).toEqual(['hook:null', 'consumer:null']);
    expect(FakeXHR.created).toHaveLength(0);

    resolveFetch({ isConnected: true });
    await act(async () => {
      await flush();
    });
    const request = FakeXHR.created[0];
    expect(request?.url).toBe('https://www.google.com/');
    expect(request?.timeout).toBe(10000);
    expect(request?.method).toBe('HEAD');

    await act(async () => {
      request?.respond(204);
      await flush();
    });

    expect(texts(renderer)).toEqual(['hook:true', 'consumer:true']);
  });

  it('al desmontar se detiene el intervalo y al remontar el estado vuelve a null', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue({ isConnected: true });

    function HookStatus() {
      return <span>{String(useIsConnected())}</span>;
    }

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = mount(
        <NetworkProvider pingInterval={1000}>
          <HookStatus />
        </NetworkProvider>,
      );
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      FakeXHR.created[0]?.respond(204);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(texts(renderer)).toEqual(['true']);

    const fetches = fetchMock.mock.calls.length;
    const requests = FakeXHR.created.length;
    await act(async () => {
      renderer.unmount();
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(fetches);
    expect(FakeXHR.created).toHaveLength(requests);

    let resolveFetch: (state: { isConnected: boolean }) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    await act(async () => {
      renderer = mount(
        <NetworkProvider pingInterval={1000}>
          <HookStatus />
        </NetworkProvider>,
      );
    });

    expect(texts(renderer)).toEqual(['null']);
    resolveFetch({ isConnected: false });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(texts(renderer)).toEqual(['false']);
  });

  it('una configuración inválida lanza un error sin URL ni cabeceras', () => {
    const props = {
      httpMethod: 'GET',
      pingServerUrl: URL_MARKER,
      customHeaders: { [HEADER_NAME]: HEADER_VALUE },
    } as ComponentProps<typeof NetworkProvider>;

    expect(() => {
      act(() => {
        mount(<NetworkProvider {...props} />);
      });
    }).toThrow('El método del ping debe ser HEAD u OPTIONS.');
    try {
      act(() => {
        mount(<NetworkProvider {...props} />);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(URL_MARKER);
      expect(message).not.toContain(HEADER_NAME);
      expect(message).not.toContain(HEADER_VALUE);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('useIsConnected fuera del provider lanza un error y no fabrica un estado', () => {
    function Orphan() {
      return <span>{String(useIsConnected())}</span>;
    }

    expect(() => {
      act(() => {
        mount(<Orphan />);
      });
    }).toThrow('useIsConnected debe usarse dentro de NetworkProvider.');
  });
});
