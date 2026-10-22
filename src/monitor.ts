import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import {
  resolveConnectivityConfig,
  type ConnectivityConfig,
  type ConnectivityConfigInput,
} from './config';
import { ping, PingCancelledError, type ActivePing } from './ping';

export interface ConnectivityMonitor {
  getState(): boolean | null;
  subscribe(listener: (state: boolean | null) => void): () => void;
  stop(): void;
}

/**
 * Cada llamada crea su propio monitor. Importar este módulo no suscribe nada.
 */
export function startConnectivityMonitor(
  input: ConnectivityConfigInput = {},
): ConnectivityMonitor {
  const config = resolveConnectivityConfig(input);
  let state: boolean | null = null;
  let generation = 0;
  let stopped = false;
  let appState: AppStateStatus = AppState.currentState;
  let activePing: ActivePing | null = null;
  const listeners = new Set<(state: boolean | null) => void>();

  const isCurrent = (token: number) => !stopped && token === generation;

  const publish = (next: boolean | null) => {
    if (stopped || state === next) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) {
      listener(next);
    }
  };

  const cancelPing = () => {
    activePing?.abort();
    activePing = null;
  };

  const runPing = (token: number) => {
    const currentPing = ping({
      url: config.pingServerUrl,
      timeout: config.pingTimeout,
      method: config.httpMethod,
      headers: config.customHeaders,
    });
    if (!isCurrent(token)) {
      currentPing.abort();
      return;
    }
    activePing = currentPing;
    void currentPing.promise.then(
      (hasAccess) => {
        if (activePing === currentPing) {
          activePing = null;
        }
        if (!isCurrent(token)) {
          return;
        }
        publish(hasAccess);
      },
      (error: unknown) => {
        if (activePing === currentPing) {
          activePing = null;
        }
        if (!isCurrent(token) || error instanceof PingCancelledError) {
          return;
        }
        publish(false);
      },
    );
  };

  const applyInterface = (token: number, isConnected: boolean | null) => {
    if (!isCurrent(token)) {
      return;
    }
    if (isConnected === null) {
      publish(null);
      return;
    }
    if (appState !== 'active' && !config.pingInBackground) {
      if (!isConnected) {
        publish(false);
      }
      return;
    }
    if (!config.shouldPing || !isConnected) {
      publish(isConnected);
      return;
    }
    runPing(token);
  };

  const beginCheck = (source?: NetInfoState) => {
    const token = ++generation;
    cancelPing();
    if (source) {
      applyInterface(token, readConnection(source));
      return;
    }
    void NetInfo.fetch().then(
      (fetched) => {
        applyInterface(token, readConnection(fetched));
      },
      () => {
        if (isCurrent(token)) {
          publish(null);
        }
      },
    );
  };

  const onNetInfo = (next: NetInfoState) => {
    if (!stopped) {
      beginCheck(next);
    }
  };

  const onAppState = (next: AppStateStatus) => {
    const wasActive = appState === 'active';
    appState = next;
    if (!stopped && next === 'active' && !wasActive) {
      beginCheck();
    }
  };

  const netInfoSubscription = NetInfo.addEventListener(onNetInfo);
  const appStateSubscription = AppState.addEventListener('change', onAppState);
  const intervalId =
    config.pingInterval > 0
      ? setInterval(() => {
          if (stopped) {
            return;
          }
          if (config.pingOnlyIfOffline && state === true) {
            return;
          }
          beginCheck();
        }, config.pingInterval)
      : null;

  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    beginCheck();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      generation += 1;
      cancelPing();
      netInfoSubscription();
      appStateSubscription.remove();
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    },
  };
}

function readConnection(state: NetInfoState | null | undefined): boolean | null {
  if (state == null || typeof state.isConnected !== 'boolean') {
    return null;
  }
  return state.isConnected;
}

export type { ConnectivityConfig, ConnectivityConfigInput };
