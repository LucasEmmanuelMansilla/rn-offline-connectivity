declare module 'react-native' {
  export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

  export interface AppStateSubscription {
    remove(): void;
  }

  export const AppState: {
    currentState: AppStateStatus;
    addEventListener(
      type: 'change',
      handler: (state: AppStateStatus) => void,
    ): AppStateSubscription;
  };

  export const Platform: {
    OS: string;
  };
}
