import NetInfo from '@react-native-community/netinfo';
import { checkInternetConnection } from './checkInternetConnection';

jest.mock(
  '@react-native-community/netinfo',
  () => {
    const fetch = jest.fn();
    return {
      __esModule: true,
      fetch,
      default: { fetch },
    };
  },
  { virtual: true },
);

const URL_MARKER = 'https://offline.example/ping-url-marker';
const HEADER_NAME = 'X-Marker-Header';
const HEADER_VALUE = 'header-value-marker';

class FakeXHR {
  static created: FakeXHR[] = [];

  status = 0;
  timeout = 0;
  method = '';
  url = '';
  requestHeaders: Record<string, string> = {};
  aborted = false;
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
    this.aborted = true;
    this.onabort?.();
  }

  respond(status: number): void {
    this.status = status;
    this.onload?.();
  }
}

const fetchMock = NetInfo.fetch as jest.Mock;

function lastRequest(): FakeXHR {
  const request = FakeXHR.created[FakeXHR.created.length - 1];
  if (!request) {
    throw new Error('No se abrió ninguna petición.');
  }
  return request;
}

async function settleFetch(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('checkInternetConnection', () => {
  beforeEach(() => {
    FakeXHR.created = [];
    fetchMock.mockReset();
    (globalThis as { XMLHttpRequest: typeof FakeXHR }).XMLHttpRequest = FakeXHR;
  });

  it('sin argumentos y sin interfaz se resuelve con false y no hace ping', async () => {
    fetchMock.mockResolvedValue({ isConnected: false });

    await expect(checkInternetConnection()).resolves.toBe(false);

    expect(FakeXHR.created).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sin argumentos usa el servidor, la espera y el método por defecto', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });

    const pending = checkInternetConnection();
    await settleFetch();
    const request = lastRequest();
    expect(request.url).toBe('https://www.google.com/');
    expect(request.timeout).toBe(10000);
    expect(request.method).toBe('HEAD');
    expect(request.requestHeaders).toMatchObject({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    request.respond(204);
    await expect(pending).resolves.toBe(true);
  });

  it('un HTTP 302 se resuelve con true', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });

    const pending = checkInternetConnection(URL_MARKER);
    await settleFetch();
    lastRequest().respond(302);

    await expect(pending).resolves.toBe(true);
  });

  it('incluye las cabeceras de la app en el ping', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });

    const pending = checkInternetConnection(URL_MARKER, 10000, true, 'HEAD', {
      [HEADER_NAME]: HEADER_VALUE,
    });
    await settleFetch();
    expect(lastRequest().requestHeaders[HEADER_NAME]).toBe(HEADER_VALUE);
    lastRequest().respond(204);
    await pending;
  });

  it.each([
    ['isConnected null', { isConnected: null }],
    ['estado sin isConnected', {}],
    ['estado nulo', null],
  ])('una lectura incompleta (%s) se resuelve con false y no hace ping', async (_label, state) => {
    fetchMock.mockResolvedValue(state);

    await expect(checkInternetConnection()).resolves.toBe(false);

    expect(FakeXHR.created).toHaveLength(0);
  });

  it('una lectura rechazada se resuelve con false y no hace ping', async () => {
    fetchMock.mockRejectedValue(new Error('netinfo no disponible'));

    await expect(checkInternetConnection()).resolves.toBe(false);

    expect(FakeXHR.created).toHaveLength(0);
  });

  it('cada llamada abre su petición y no cancela a las demás', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });

    const first = checkInternetConnection('https://offline.example/one');
    const second = checkInternetConnection('https://offline.example/two', 10000, true, 'OPTIONS');
    await settleFetch();

    expect(FakeXHR.created).toHaveLength(2);
    expect(FakeXHR.created[0]?.url).toBe('https://offline.example/one');
    expect(FakeXHR.created[1]?.url).toBe('https://offline.example/two');
    expect(FakeXHR.created[1]?.method).toBe('OPTIONS');
    FakeXHR.created[1]?.respond(404);
    FakeXHR.created[0]?.respond(204);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(FakeXHR.created[0]?.aborted).toBe(false);
    expect(FakeXHR.created[1]?.aborted).toBe(false);
  });

  it('sin ping informa la interfaz y no abre una petición', async () => {
    fetchMock.mockResolvedValue({ isConnected: true });

    await expect(checkInternetConnection(undefined, undefined, false)).resolves.toBe(true);

    expect(FakeXHR.created).toHaveLength(0);
  });

  it('un argumento inválido lanza un error sin la URL ni las cabeceras', () => {
    const call = checkInternetConnection as (
      url?: unknown,
      pingTimeout?: unknown,
      shouldPing?: unknown,
      method?: unknown,
      customHeaders?: unknown,
    ) => Promise<boolean>;

    expect(() =>
      call(URL_MARKER, 10000, true, 'GET', { [HEADER_NAME]: HEADER_VALUE }),
    ).toThrow('El método del ping debe ser HEAD u OPTIONS.');

    try {
      call(URL_MARKER, 10000, true, 'GET', { [HEADER_NAME]: HEADER_VALUE });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(URL_MARKER);
      expect(message).not.toContain(HEADER_NAME);
      expect(message).not.toContain(HEADER_VALUE);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeXHR.created).toHaveLength(0);
  });
});
