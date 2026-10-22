import NetInfo from '@react-native-community/netinfo';
import * as ReactNative from 'react-native';
import { AppState, Platform } from 'react-native';
import type { ConnectivityConfigInput } from './config';
import { startConnectivityMonitor, type ConnectivityMonitor } from './monitor';

jest.mock(
  '@react-native-community/netinfo',
  () => {
    const fetch = jest.fn();
    const addEventListener = jest.fn();
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
  () => {
    const appListeners = new Set<(state: string) => void>();
    const app = { current: 'active' };
    return {
      Platform: { OS: 'ios' },
      PermissionsAndroid: {
        request: jest.fn(),
        check: jest.fn(),
      },
      AppState: {
        get currentState() {
          return app.current;
        },
        set currentState(value: string) {
          app.current = value;
        },
        addEventListener: jest.fn((_type: string, listener: (state: string) => void) => {
          appListeners.add(listener);
          return {
            remove: jest.fn(() => {
              appListeners.delete(listener);
            }),
          };
        }),
      },
      emitAppState(next: string) {
        app.current = next;
        for (const listener of appListeners) {
          listener(next);
        }
      },
    };
  },
  { virtual: true },
);

const URL_MARKER = 'https://offline.example/ping-url-marker';
const HEADER_NAME = 'X-Marker-Header';
const HEADER_VALUE = 'header-value-marker';

const fetchMock = NetInfo.fetch as jest.Mock;
const addEventListenerMock = NetInfo.addEventListener as jest.Mock;
const reactNative = ReactNative as typeof ReactNative & {
  emitAppState: (next: string) => void;
  PermissionsAndroid: { request: jest.Mock; check: jest.Mock };
};

class FakeXHR {
  static created: FakeXHR[] = [];

  status = 0;
  timeoutMs = 0;
  method = '';
  url = '';
  requestHeaders: Record<string, string> = {};
  aborted = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  open(method: string, url: string): void {
    FakeXHR.created.push(this);
    this.method = method;
    this.url = url;
  }

  set timeout(value: number) {
    this.timeoutMs = value;
    this.clearTimer();
    if (value > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.ontimeout?.();
      }, value);
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  get timeout(): number {
    return this.timeoutMs;
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  send(): void {}

  abort(): void {
    this.clearTimer();
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    this.onabort?.();
  }

  respond(status: number): void {
    this.clearTimer();
    this.status = status;
    this.onload?.();
  }

  failNetwork(): void {
    this.clearTimer();
    this.onerror?.();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

let netInfoListener: ((state: { isConnected: boolean | null }) => void) | null = null;
let unsubscribeNetInfo: jest.Mock;
const monitors: ConnectivityMonitor[] = [];

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function start(input?: ConnectivityConfigInput): ConnectivityMonitor {
  const monitor = startConnectivityMonitor(input);
  monitors.push(monitor);
  return monitor;
}

function lastRequest(): FakeXHR {
  const request = FakeXHR.created[FakeXHR.created.length - 1];
  if (!request) {
    throw new Error('No se abrió ninguna petición.');
  }
  return request;
}

describe('monitor de conectividad', () => {
  beforeEach(() => {
    FakeXHR.created = [];
    monitors.length = 0;
    netInfoListener = null;
    unsubscribeNetInfo = jest.fn();
    (Platform as { OS: string }).OS = 'ios';
    (AppState as { currentState: string }).currentState = 'active';
    (globalThis as { XMLHttpRequest: typeof FakeXHR }).XMLHttpRequest = FakeXHR;
    fetchMock.mockReset();
    addEventListenerMock.mockReset();
    (AppState.addEventListener as jest.Mock).mockClear();
    addEventListenerMock.mockImplementation((listener: typeof netInfoListener) => {
      netInfoListener = listener;
      return unsubscribeNetInfo;
    });
    reactNative.PermissionsAndroid.request.mockClear();
    reactNative.PermissionsAndroid.check.mockClear();
  });

  afterEach(() => {
    monitors.splice(0).forEach((monitor) => monitor.stop());
    jest.useRealTimers();
  });

  it('importar el módulo no consulta ni suscribe', () => {
    jest.isolateModules(() => {
      require('./monitor');
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(addEventListenerMock).not.toHaveBeenCalled();
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])(
    'en %s la lectura inicial no espera al listener y el estado sigue null',
    async (os) => {
      (Platform as { OS: string }).OS = os;
      let resolveFetch: (state: { isConnected: boolean }) => void = () => undefined;
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );

      const monitor = start();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(addEventListenerMock).toHaveBeenCalledTimes(1);
      expect(monitor.getState()).toBeNull();
      expect(FakeXHR.created).toHaveLength(0);

      resolveFetch({ isConnected: false });
      await flush();
      expect(monitor.getState()).toBe(false);
    },
  );

  it('sin interfaz no abre un ping y publica sin acceso', async () => {
    fetchMock.mockResolvedValue({ isConnected: false });

    const monitor = start({ shouldPing: true });
    await flush();

    expect(monitor.getState()).toBe(false);
    expect(FakeXHR.created).toHaveLength(0);
  });

  it.each([
    [204, true],
    [302, true],
    [404, false],
    [500, false],
  ])('con interfaz, HTTP %s publica %s', async (status, expected) => {
    fetchMock.mockResolvedValue({ isConnected: true });

    const monitor = start({
      customHeaders: { [HEADER_NAME]: HEADER_VALUE },
      httpMethod: 'OPTIONS',
    });
    await flush();
    const request = lastRequest();
    expect(request.method).toBe('OPTIONS');
    expect(request.requestHeaders[HEADER_NAME]).toBe(HEADER_VALUE);
    request.respond(status);
    await flush();

    expect(monitor.getState()).toBe(expected);
  });

  it('un error de red publica sin acceso', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });
    const monitor = start();
    await flush();
    lastRequest().failNetwork();
    await flush();

    expect(monitor.getState()).toBe(false);
  });

  it('el timeout de 10000 ms publica sin acceso', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue({ isConnected: true });
    const monitor = start();
    await jest.advanceTimersByTimeAsync(0);

    expect(lastRequest().timeout).toBe(10000);
    expect(monitor.getState()).toBeNull();
    await jest.advanceTimersByTimeAsync(9999);
    expect(monitor.getState()).toBeNull();
    await jest.advanceTimersByTimeAsync(1);

    expect(monitor.getState()).toBe(false);
  });

  it('en segundo plano recuperar la red no cambia el estado y perderla lo deja sin acceso', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });
    const monitor = start();
    await flush();
    lastRequest().respond(204);
    await flush();
    expect(monitor.getState()).toBe(true);
    const requestsBeforeBackground = FakeXHR.created.length;

    reactNative.emitAppState('background');
    netInfoListener?.({ isConnected: true });
    expect(monitor.getState()).toBe(true);

    netInfoListener?.({ isConnected: false });
    expect(monitor.getState()).toBe(false);

    netInfoListener?.({ isConnected: true });
    expect(monitor.getState()).toBe(false);
    expect(FakeXHR.created).toHaveLength(requestsBeforeBackground);
  });

  it('al volver a primer plano conserva el estado hasta el resultado nuevo', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });
    const monitor = start();
    await flush();
    lastRequest().respond(204);
    await flush();

    let resolveFetch: (state: { isConnected: boolean }) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    reactNative.emitAppState('background');
    reactNative.emitAppState('active');

    expect(monitor.getState()).toBe(true);
    resolveFetch({ isConnected: true });
    await flush();
    expect(monitor.getState()).toBe(true);
    lastRequest().respond(500);
    await flush();

    expect(monitor.getState()).toBe(false);
  });

  it('si el estado aún es null, la vuelta a primer plano no fabrica un valor', async () => {
    let resolveFetch: (state: { isConnected: boolean }) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const monitor = start();
    reactNative.emitAppState('background');
    reactNative.emitAppState('active');

    expect(monitor.getState()).toBeNull();
    resolveFetch({ isConnected: false });
    await flush();
    expect(monitor.getState()).toBe(false);
  });

  it('una comprobación nueva aborta la anterior y descarta su resultado tardío', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });
    const monitor = start();
    await flush();
    const first = lastRequest();

    netInfoListener?.({ isConnected: true });
    const second = lastRequest();

    expect(first.aborted).toBe(true);
    expect(second).not.toBe(first);
    second.respond(302);
    await flush();
    expect(monitor.getState()).toBe(true);
    first.respond(500);
    await flush();

    expect(monitor.getState()).toBe(true);
  });

  it('si NetInfo no completa la lectura el estado queda null y no pide permisos', async () => {
    fetchMock.mockRejectedValue(new Error('lectura rechazada'));
    const monitor = start();
    await flush();

    expect(monitor.getState()).toBeNull();
    expect(FakeXHR.created).toHaveLength(0);
    expect(reactNative.PermissionsAndroid.request).not.toHaveBeenCalled();
    expect(reactNative.PermissionsAndroid.check).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ isConnected: null });
    const incomplete = start();
    await flush();
    expect(incomplete.getState()).toBeNull();
    expect(FakeXHR.created).toHaveLength(0);
  });

  it('desmontar cancela la suscripción, el intervalo y el ping', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue({ isConnected: true });
    const monitor = start({ pingInterval: 1000 });
    await jest.advanceTimersByTimeAsync(0);
    const request = lastRequest();
    const subscription = (AppState.addEventListener as jest.Mock).mock.results.at(-1)?.value as {
      remove: jest.Mock;
    };
    const fetches = fetchMock.mock.calls.length;

    monitor.stop();

    expect(request.aborted).toBe(true);
    expect(unsubscribeNetInfo).toHaveBeenCalledTimes(1);
    expect(subscription.remove).toHaveBeenCalledTimes(1);
    request.respond(204);
    await jest.advanceTimersByTimeAsync(5000);

    expect(monitor.getState()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(fetches);
  });

  it('el intervalo se detiene mientras hay acceso si solo debe repetirse sin acceso', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue({ isConnected: true });
    const monitor = start({
      pingInterval: 1000,
      pingOnlyIfOffline: true,
      shouldPing: false,
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(monitor.getState()).toBe(true);

    fetchMock.mockClear();
    await jest.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();

    netInfoListener?.({ isConnected: false });
    expect(monitor.getState()).toBe(false);
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('una configuración inválida lanza un error sin URL ni cabeceras y no suscribe', () => {
    const startInvalid = () =>
      start({
        httpMethod: 'GET',
        pingServerUrl: URL_MARKER,
        customHeaders: { [HEADER_NAME]: HEADER_VALUE },
      });

    expect(startInvalid).toThrow('El método del ping debe ser HEAD u OPTIONS.');
    try {
      startInvalid();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(URL_MARKER);
      expect(message).not.toContain(HEADER_NAME);
      expect(message).not.toContain(HEADER_VALUE);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addEventListenerMock).not.toHaveBeenCalled();
  });
});
