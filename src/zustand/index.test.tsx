import { act, type ReactNode } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import NetInfo from '@react-native-community/netinfo';
import { NetworkProvider } from '../react';
import * as api from './index';
import { resetNetworkStoreForTests, startedDuringModuleInit } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { IS_REACT_NATIVE_TEST_ENVIRONMENT?: boolean }).IS_REACT_NATIVE_TEST_ENVIRONMENT =
  true;

const listeners = new Set<(state: { isConnected: boolean | null }) => void>();

jest.mock(
  '@react-native-async-storage/async-storage',
  () => {
    throw new Error('el store no debe cargar almacenamiento');
  },
  { virtual: true },
);

jest.mock(
  '@react-native-community/netinfo',
  () => {
    const fetch = jest.fn();
    const addEventListener = jest.fn((listener: (state: { isConnected: boolean | null }) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });
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

class FakeXHR {
  static created: FakeXHR[] = [];

  status = 0;
  timeout = 0;
  url = '';
  method = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string): void {
    FakeXHR.created.push(this);
    this.method = method;
    this.url = url;
  }

  setRequestHeader(): void {}

  send(): void {}

  abort(): void {
    this.onabort?.();
  }

  respond(status: number): void {
    this.status = status;
    this.onload?.();
  }
}

const fetchMock = NetInfo.fetch as jest.Mock;

const storage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

describe('store Zustand', () => {
  const renderers: ReactTestRenderer[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    FakeXHR.created = [];
    listeners.clear();
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    storage.removeItem.mockClear();
    storage.clear.mockClear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
    (globalThis as { XMLHttpRequest: typeof FakeXHR }).XMLHttpRequest = FakeXHR;
    resetNetworkStoreForTests();
    fetchMock.mockReset();
    listeners.clear();
  });

  afterEach(() => {
    act(() => {
      renderers.splice(0).forEach((renderer) => renderer.unmount());
    });
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function mount(element: ReactNode): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(element);
    });
    renderers.push(renderer);
    return renderer;
  }

  function text(renderer: ReactTestRenderer): string {
    return renderer.root.findAllByType('span').at(-1)?.children.join('') ?? '';
  }

  async function shown(): Promise<ReactTestRenderer> {
    function Probe() {
      const { isConnected, pendingKeys } = api.useNetworkStore();
      return <span>{`${String(isConnected)}|${pendingKeys.join(',')}`}</span>;
    }
    const renderer = mount(<Probe />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    return renderer;
  }

  async function publishAccess(): Promise<void> {
    act(() => {
      listeners.forEach((listener) => listener({ isConnected: true }));
    });
    await act(async () => {
      FakeXHR.created.at(-1)?.respond(204);
      await jest.advanceTimersByTimeAsync(0);
    });
  }

  it('importar el módulo no arranca el monitor', () => {
    expect(startedDuringModuleInit).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Object.keys(api).sort()).toEqual([
      'dismiss',
      'enqueue',
      'pauseQueue',
      'resumeQueue',
      'useNetworkStore',
    ]);
  });

  it('el hook nace en null y después sigue la interfaz y el ping', async () => {
    let resolveFetch: (state: { isConnected: boolean | null }) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    const renderer = mount(<Snapshot />);

    expect(text(renderer)).toBe('null|');
    expect(FakeXHR.created).toHaveLength(0);

    resolveFetch({ isConnected: false });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(text(renderer)).toBe('false|');
    expect(FakeXHR.created).toHaveLength(0);

    await publishAccess();
    expect(text(renderer)).toBe('true|');
  });

  it('retiene el trabajo con null o sin acceso y lo ejecuta si ya hay acceso', async () => {
    let resolveFetch: (state: { isConnected: boolean | null }) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const ran: string[] = [];
    const renderer = mount(<Snapshot />);
    act(() => {
      api.enqueue(() => ran.push('null'), 'mientras-null');
    });
    expect(ran).toEqual([]);
    expect(text(renderer)).toBe('null|mientras-null');

    resolveFetch({ isConnected: false });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(ran).toEqual([]);
    expect(text(renderer)).toBe('false|mientras-null');

    resetNetworkStoreForTests();
    fetchMock.mockReset();
    listeners.clear();
    FakeXHR.created = [];
    fetchMock.mockResolvedValue({ isConnected: true });
    const onlineView = await shown();
    await act(async () => {
      FakeXHR.created.at(-1)?.respond(204);
      await jest.advanceTimersByTimeAsync(0);
    });
    act(() => {
      api.enqueue(() => ran.push('online'), 'al-momento');
    });

    expect(ran).toEqual(['online']);
    expect(text(onlineView)).toBe('true|');
  });

  it('emite en orden con 50 ms entre inicios', async () => {
    fetchMock.mockResolvedValue({ isConnected: false });
    const started: string[] = [];
    const renderer = await shown();
    act(() => {
      api.enqueue(() => started.push('a'), 'a');
      api.enqueue(() => started.push('b'), 'b');
      api.enqueue(() => started.push('c'), 'c');
    });
    expect(text(renderer)).toBe('false|a,b,c');

    await publishAccess();
    expect(started).toEqual(['a']);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(49);
    });
    expect(started).toEqual(['a']);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(started).toEqual(['a', 'b']);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });
    expect(started).toEqual(['a', 'b', 'c']);
    expect(text(renderer)).toBe('true|');
  });

  it('repite una clave al final y dismiss evita que se ejecute', async () => {
    fetchMock.mockResolvedValue({ isConnected: false });
    const started: string[] = [];
    const renderer = await shown();
    act(() => {
      api.enqueue(() => started.push('vieja'), 'a');
      api.enqueue(() => started.push('b'), 'b');
      api.enqueue(() => started.push('nueva'), 'a');
      api.enqueue(() => started.push('descartada'), 'c');
      api.dismiss('c');
    });
    expect(text(renderer)).toBe('false|b,a');

    await publishAccess();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });
    expect(started).toEqual(['b', 'nueva']);
  });

  it('pausar detiene el siguiente trabajo y reanudar lo continúa', async () => {
    fetchMock.mockResolvedValue({ isConnected: false });
    const started: string[] = [];
    await shown();
    act(() => {
      api.enqueue(() => started.push('a'), 'a');
      api.enqueue(() => started.push('b'), 'b');
      api.enqueue(() => started.push('c'), 'c');
    });
    await publishAccess();
    act(() => {
      api.pauseQueue();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(started).toEqual(['a']);

    act(() => {
      api.resumeQueue();
    });
    expect(started).toEqual(['a', 'b']);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });
    expect(started).toEqual(['a', 'b', 'c']);
  });

  it('una función que lanza no se reencola ni se registra', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue({ isConnected: true });
    const started: string[] = [];
    const renderer = await shown();
    await act(async () => {
      FakeXHR.created.at(-1)?.respond(204);
      await jest.advanceTimersByTimeAsync(0);
    });
    act(() => {
      api.enqueue(() => {
        throw new Error('fallo interno');
      }, 'rota');
      api.enqueue(() => started.push('siguiente'), 'siguiente');
    });

    expect(text(renderer)).toBe('true|');
    expect(started).toEqual(['siguiente']);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('no escribe almacenamiento', async () => {
    fetchMock.mockResolvedValue({ isConnected: false });
    const renderer = await shown();
    act(() => {
      api.enqueue(() => undefined, 'pendiente');
    });

    expect(text(renderer)).toBe('false|pendiente');
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
  });

  it('el monitor del store usa la configuración por defecto y no la del provider', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });
    mount(
      <NetworkProvider pingServerUrl="https://offline.example/provider">
        <span>provider</span>
      </NetworkProvider>,
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await shown();

    const urls = FakeXHR.created.map((request) => request.url);
    expect(urls).toContain('https://offline.example/provider');
    expect(urls).toContain('https://www.google.com/');
  });
});

function Snapshot() {
  const { isConnected, pendingKeys } = api.useNetworkStore();
  return <span>{`${String(isConnected)}|${pendingKeys.join(',')}`}</span>;
}
