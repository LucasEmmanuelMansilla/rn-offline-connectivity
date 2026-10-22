export const DEFAULT_PING_URL = 'https://www.google.com/';
export const DEFAULT_PING_TIMEOUT_MS = 10000;
export const DEFAULT_PING_METHOD = 'HEAD';

const EMPTY_HEADERS: Readonly<Record<string, string>> = {};

export interface ConnectivityConfig {
  pingTimeout: number;
  pingServerUrl: string;
  shouldPing: boolean;
  pingInterval: number;
  pingOnlyIfOffline: boolean;
  pingInBackground: boolean;
  httpMethod: 'HEAD' | 'OPTIONS';
  customHeaders: Readonly<Record<string, string>>;
}

export interface ConnectivityConfigInput {
  pingTimeout?: unknown;
  pingServerUrl?: unknown;
  shouldPing?: unknown;
  pingInterval?: unknown;
  pingOnlyIfOffline?: unknown;
  pingInBackground?: unknown;
  httpMethod?: unknown;
  customHeaders?: unknown;
}

export function assertPingArguments(
  url: string,
  pingTimeout: number,
  shouldPing: boolean,
  method: string,
  customHeaders: Readonly<Record<string, string>>,
): void {
  assertUrl(url);
  assertTimeout(pingTimeout);
  assertBoolean(shouldPing, 'shouldPing debe ser un booleano.');
  assertMethod(method);
  assertHeaders(customHeaders);
}

export function resolveConnectivityConfig(
  input: ConnectivityConfigInput = {},
): ConnectivityConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('La configuración del ping no es válida.');
  }

  const pingServerUrl = input.pingServerUrl ?? DEFAULT_PING_URL;
  const pingTimeout = input.pingTimeout ?? DEFAULT_PING_TIMEOUT_MS;
  const shouldPing = input.shouldPing ?? true;
  const pingInterval = input.pingInterval ?? 0;
  const pingOnlyIfOffline = input.pingOnlyIfOffline ?? false;
  const pingInBackground = input.pingInBackground ?? false;
  const httpMethod = input.httpMethod ?? DEFAULT_PING_METHOD;
  const customHeaders = input.customHeaders ?? EMPTY_HEADERS;

  assertUrl(pingServerUrl);
  assertTimeout(pingTimeout);
  assertBoolean(shouldPing, 'shouldPing debe ser un booleano.');
  assertNonNegativeNumber(pingInterval, 'El intervalo del ping debe ser un número.');
  assertBoolean(pingOnlyIfOffline, 'pingOnlyIfOffline debe ser un booleano.');
  assertBoolean(pingInBackground, 'pingInBackground debe ser un booleano.');
  assertMethod(httpMethod);
  assertHeaders(customHeaders);

  return {
    pingServerUrl,
    pingTimeout,
    shouldPing,
    pingInterval,
    pingOnlyIfOffline,
    pingInBackground,
    httpMethod,
    customHeaders,
  };
}

function assertUrl(url: unknown): asserts url is string {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('La URL del ping debe ser un texto.');
  }
}

function assertTimeout(timeout: unknown): asserts timeout is number {
  assertNonNegativeNumber(timeout, 'La espera del ping debe ser un número.');
}

function assertNonNegativeNumber(value: unknown, message: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(message);
  }
}

function assertBoolean(value: unknown, message: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error(message);
  }
}

function assertMethod(method: unknown): asserts method is 'HEAD' | 'OPTIONS' {
  if (method !== 'HEAD' && method !== 'OPTIONS') {
    throw new Error('El método del ping debe ser HEAD u OPTIONS.');
  }
}

function assertHeaders(
  headers: unknown,
): asserts headers is Readonly<Record<string, string>> {
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
    throw new Error('Las cabeceras del ping deben ser un objeto de textos.');
  }
  if (!Object.values(headers).every((header) => typeof header === 'string')) {
    throw new Error('Las cabeceras del ping deben ser un objeto de textos.');
  }
}
