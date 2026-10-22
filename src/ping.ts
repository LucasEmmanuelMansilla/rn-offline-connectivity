export type PingHeaders = Readonly<Record<string, string>>;

const NO_CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export class PingCancelledError extends Error {
  constructor() {
    super('El ping se canceló.');
    this.name = 'PingCancelledError';
  }
}

export interface PingRequest {
  url: string;
  timeout: number;
  method: string;
  headers?: PingHeaders;
}

export interface ActivePing {
  promise: Promise<boolean>;
  abort: () => void;
}

interface PingXHR {
  status: number;
  timeout: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(): void;
  abort(): void;
}

interface PingXHRConstructor {
  new (): PingXHR;
}

function createRequest(): PingXHR {
  const scope = globalThis as { XMLHttpRequest?: PingXHRConstructor };
  const Constructor = scope.XMLHttpRequest;
  if (typeof Constructor !== 'function') {
    throw new Error('XMLHttpRequest no está disponible.');
  }
  return new Constructor();
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

/**
 * Comprueba el acceso con una petición que no sigue redirecciones.
 * `abort` cancela esta petición y rechaza su promesa; no decide el estado de la app.
 */
export function ping(request: PingRequest): ActivePing {
  if (request.method !== 'HEAD' && request.method !== 'OPTIONS') {
    throw new Error('El método del ping debe ser HEAD u OPTIONS.');
  }

  const xhr = createRequest();
  let settled = false;

  const promise = new Promise<boolean>((resolve, reject) => {
    const resolveOnce = (hasAccess: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(hasAccess);
    };

    const rejectCancelled = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new PingCancelledError());
    };

    xhr.onload = () => {
      resolveOnce(isSuccessStatus(xhr.status));
    };
    xhr.onerror = () => {
      resolveOnce(false);
    };
    xhr.ontimeout = () => {
      resolveOnce(false);
    };
    xhr.onabort = () => {
      rejectCancelled();
    };

    xhr.open(request.method, request.url, true);
    xhr.timeout = request.timeout;

    const headers: Record<string, string> = {
      ...NO_CACHE_HEADERS,
      ...request.headers,
    };
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.send();
  });

  return {
    promise,
    abort() {
      xhr.abort();
    },
  };
}
