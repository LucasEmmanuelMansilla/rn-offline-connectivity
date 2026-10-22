import NetInfo from '@react-native-community/netinfo';
import {
  assertPingArguments,
  DEFAULT_PING_METHOD,
  DEFAULT_PING_TIMEOUT_MS,
  DEFAULT_PING_URL,
} from './config';
import { ping, PingCancelledError } from './ping';

export function checkInternetConnection(
  url: string = DEFAULT_PING_URL,
  pingTimeout: number = DEFAULT_PING_TIMEOUT_MS,
  shouldPing: boolean = true,
  method: string = DEFAULT_PING_METHOD,
  customHeaders: Readonly<Record<string, string>> = {},
): Promise<boolean> {
  assertPingArguments(url, pingTimeout, shouldPing, method, customHeaders);
  return readConnection(url, pingTimeout, shouldPing, method, customHeaders);
}

async function readConnection(
  url: string,
  pingTimeout: number,
  shouldPing: boolean,
  method: string,
  customHeaders: Readonly<Record<string, string>>,
): Promise<boolean> {
  let isConnected: boolean | null;
  try {
    const state = await NetInfo.fetch();
    isConnected = state?.isConnected ?? null;
  } catch {
    return false;
  }

  if (typeof isConnected !== 'boolean') {
    return false;
  }
  if (!shouldPing) {
    return isConnected;
  }
  if (!isConnected) {
    return false;
  }

  try {
    return await ping({
      url,
      timeout: pingTimeout,
      method,
      headers: customHeaders,
    }).promise;
  } catch (error) {
    if (error instanceof PingCancelledError) {
      throw error;
    }
    return false;
  }
}
