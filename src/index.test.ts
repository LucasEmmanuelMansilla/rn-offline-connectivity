import NetInfo from '@react-native-community/netinfo';
import { checkInternetConnection as checkFromModule } from './checkInternetConnection';

jest.mock(
  'zustand',
  () => {
    throw new Error('zustand no debe cargarse');
  },
  { virtual: true },
);

jest.mock(
  '@react-native-community/netinfo',
  () => {
    const fetch = jest.fn();
    const addEventListener = jest.fn(() => jest.fn());
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
  () => ({
    Platform: { OS: 'ios' },
    AppState: {
      currentState: 'active',
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
  }),
  { virtual: true },
);

describe('entrada principal', () => {
  it('exporta la API de React y la consulta, sin cargar Zustand', async () => {
    const api = await import('./index');

    expect(Object.keys(api).sort()).toEqual([
      'NetworkConsumer',
      'NetworkProvider',
      'checkInternetConnection',
      'useIsConnected',
    ]);
    expect(api.checkInternetConnection).toBe(checkFromModule);
    expect(NetInfo.fetch).not.toHaveBeenCalled();
    expect(NetInfo.addEventListener).not.toHaveBeenCalled();
  });

  it('declara Zustand como peer opcional y no depende de Redux', () => {
    const packageJson = require('../package.json') as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: { zustand: { optional: boolean } };
    };
    const names = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies),
    ];

    expect(packageJson.peerDependenciesMeta.zustand.optional).toBe(true);
    expect(packageJson.dependencies).toBeUndefined();
    expect(names).not.toContain('redux');
    expect(names).not.toContain('react-redux');
    expect(names).not.toContain('redux-saga');
    expect(names).not.toContain('lodash');
  });
});
