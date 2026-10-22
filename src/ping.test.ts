import { ping, PingCancelledError } from './ping';

const URL_MARKER = 'https://offline.example/ping-url-marker';
const HEADER_NAME = 'X-Marker-Header';
const HEADER_VALUE = 'header-value-marker';
const TIMEOUT_MS = 10000;

class FakeXHR {
  static created: FakeXHR[] = [];

  status = 0;
  timeout = 0;
  method = '';
  url = '';
  requestHeaders: Record<string, string> = {};
  sentBody: unknown = undefined;
  aborted = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string, async: boolean): void {
    FakeXHR.created.push(this);
    this.method = method;
    this.url = url;
    if (!async) {
      throw new Error('El ping de prueba exige una petición asíncrona.');
    }
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  send(body?: unknown): void {
    this.sentBody = body;
  }

  abort(): void {
    if (this.aborted) {
      return;
    }
    this.aborted = true;
    this.onabort?.();
  }

  respond(status: number): void {
    this.status = status;
    this.onload?.();
  }

  failNetwork(): void {
    this.onerror?.();
  }

  fireTimeout(): void {
    this.ontimeout?.();
  }
}

function lastRequest(): FakeXHR {
  const request = FakeXHR.created[FakeXHR.created.length - 1];
  if (!request) {
    throw new Error('No se abrió ninguna petición.');
  }
  return request;
}

function consoleText(spies: jest.SpyInstance[]): string {
  return spies
    .flatMap((spy) => spy.mock.calls as unknown[][])
    .flat()
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (value instanceof Error) {
        return `${value.name} ${value.message}`;
      }
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join('\n');
}

describe('ping', () => {
  let consoleSpies: jest.SpyInstance[] = [];

  beforeEach(() => {
    FakeXHR.created = [];
    (globalThis as { XMLHttpRequest: typeof FakeXHR }).XMLHttpRequest = FakeXHR;
    consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    consoleSpies.forEach((spy) => spy.mockRestore());
  });

  function startPing(method = 'HEAD', headers?: Record<string, string>) {
    return ping({
      url: URL_MARKER,
      timeout: TIMEOUT_MS,
      method,
      headers,
    });
  }

  it.each([
    [204, true],
    [302, true],
    [404, false],
    [500, false],
  ])('el estado HTTP %s se resuelve con %s', async (status, expected) => {
    const { promise } = startPing();
    lastRequest().respond(status);
    await expect(promise).resolves.toBe(expected);
  });

  it('el timeout configura la espera y se resuelve sin acceso', async () => {
    const { promise } = startPing();
    const request = lastRequest();
    expect(request.timeout).toBe(TIMEOUT_MS);
    request.fireTimeout();
    await expect(promise).resolves.toBe(false);
    request.respond(204);
    await expect(promise).resolves.toBe(false);
  });

  it('un error de red se resuelve sin acceso', async () => {
    const { promise } = startPing();
    lastRequest().failNetwork();
    await expect(promise).resolves.toBe(false);
  });

  it('envía las cabeceras de no-caché y las de la app, sin cuerpo', () => {
    startPing('OPTIONS', { [HEADER_NAME]: HEADER_VALUE });
    const request = lastRequest();
    expect(request.method).toBe('OPTIONS');
    expect(request.requestHeaders).toMatchObject({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      [HEADER_NAME]: HEADER_VALUE,
    });
    expect(request.sentBody).toBeUndefined();
  });

  it('abort cancela esa petición y descarta una respuesta tardía', async () => {
    const first = startPing();
    const second = startPing();
    first.abort();
    expect(FakeXHR.created[0]?.aborted).toBe(true);
    expect(FakeXHR.created[1]?.aborted).toBe(false);
    FakeXHR.created[0]?.respond(204);
    FakeXHR.created[1]?.respond(204);
    await expect(first.promise).rejects.toBeInstanceOf(PingCancelledError);
    await expect(second.promise).resolves.toBe(true);
  });

  it('un método distinto de HEAD u OPTIONS lanza un error y no abre la petición', () => {
    expect(() => startPing('GET')).toThrow('El método del ping debe ser HEAD u OPTIONS.');
    expect(FakeXHR.created).toHaveLength(0);
  });

  it.each(['éxito', 'fallo HTTP', 'timeout', 'error de red'] as const)(
    'la consola no contiene la URL, las cabeceras ni el cuerpo en %s',
    async (scenario) => {
      const { promise } = startPing('HEAD', { [HEADER_NAME]: HEADER_VALUE });
      const request = lastRequest();
      if (scenario === 'éxito') {
        request.respond(204);
        await promise;
      } else if (scenario === 'fallo HTTP') {
        request.respond(500);
        await promise;
      } else if (scenario === 'timeout') {
        request.fireTimeout();
        await promise;
      } else {
        request.failNetwork();
        await promise;
      }

      const text = consoleText(consoleSpies);
      expect(text).not.toContain(URL_MARKER);
      expect(text).not.toContain(HEADER_NAME);
      expect(text).not.toContain(HEADER_VALUE);
      expect(text).not.toContain('Cache-Control');
      expect(text).not.toContain('no-cache');
    },
  );
});
