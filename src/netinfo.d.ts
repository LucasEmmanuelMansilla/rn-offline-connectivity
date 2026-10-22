// La app instala este peer. Esta declaración solo cubre la lectura que usa la librería.
declare module '@react-native-community/netinfo' {
  export interface NetInfoState {
    isConnected: boolean | null;
  }

  export type NetInfoUnsubscribe = () => void;

  export function fetch(): Promise<NetInfoState>;

  export function addEventListener(
    listener: (state: NetInfoState) => void,
  ): NetInfoUnsubscribe;

  const netInfo: {
    fetch: typeof fetch;
    addEventListener: typeof addEventListener;
  };

  export default netInfo;
}
