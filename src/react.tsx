import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { resolveConnectivityConfig, type ConnectivityConfigInput } from './config';
import { startConnectivityMonitor } from './monitor';

const ConnectionContext = createContext<boolean | null | undefined>(undefined);

export interface NetworkProviderProps extends ConnectivityConfigInput {
  children?: ReactNode;
}

export function NetworkProvider({ children, ...input }: NetworkProviderProps): ReactNode {
  const config = resolveConnectivityConfig(input);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const {
    pingTimeout,
    pingServerUrl,
    shouldPing,
    pingInterval,
    pingOnlyIfOffline,
    pingInBackground,
    httpMethod,
    customHeaders,
  } = config;

  useEffect(() => {
    const monitor = startConnectivityMonitor({
      pingTimeout,
      pingServerUrl,
      shouldPing,
      pingInterval,
      pingOnlyIfOffline,
      pingInBackground,
      httpMethod,
      customHeaders,
    });
    const unsubscribe = monitor.subscribe(setIsConnected);
    setIsConnected(monitor.getState());
    return () => {
      unsubscribe();
      monitor.stop();
    };
  }, [
    pingTimeout,
    pingServerUrl,
    shouldPing,
    pingInterval,
    pingOnlyIfOffline,
    pingInBackground,
    httpMethod,
    customHeaders,
  ]);

  return <ConnectionContext.Provider value={isConnected}>{children}</ConnectionContext.Provider>;
}

export function useIsConnected(): boolean | null {
  const isConnected = useContext(ConnectionContext);
  if (isConnected === undefined) {
    throw new Error('useIsConnected debe usarse dentro de NetworkProvider.');
  }
  return isConnected;
}

export function NetworkConsumer({
  children,
}: {
  children: (state: { isConnected: boolean | null }) => ReactNode;
}): ReactNode {
  const isConnected = useIsConnected();
  return children({ isConnected });
}
