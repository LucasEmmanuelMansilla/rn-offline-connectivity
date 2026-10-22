import { create } from 'zustand';
import { startConnectivityMonitor, type ConnectivityMonitor } from '../monitor';
import { createWorkQueue, type WorkQueue } from '../queue';

export interface NetworkSnapshot {
  isConnected: boolean | null;
  pendingKeys: string[];
}

const store = create<NetworkSnapshot>(() => ({
  isConnected: null,
  pendingKeys: [],
}));

let queue: WorkQueue = createWorkQueue(publishPendingKeys);
let monitor: ConnectivityMonitor | null = null;
let started = false;

function publishPendingKeys(pendingKeys: string[]): void {
  store.setState({ pendingKeys });
}

function ensureStarted(): void {
  if (started) {
    return;
  }
  started = true;
  monitor = startConnectivityMonitor();
  const apply = (isConnected: boolean | null) => {
    queue.setConnected(isConnected);
    store.setState({ isConnected });
  };
  monitor.subscribe(apply);
  apply(monitor.getState());
}

export function useNetworkStore(): NetworkSnapshot {
  ensureStarted();
  return store();
}

export function enqueue(run: () => void, key: string): void {
  if (typeof run !== 'function' || typeof key !== 'string') {
    throw new Error('enqueue necesita una función y una clave de texto.');
  }
  ensureStarted();
  queue.enqueue(run, key);
}

export function dismiss(key: string): void {
  if (typeof key !== 'string') {
    throw new Error('dismiss necesita una clave de texto.');
  }
  ensureStarted();
  queue.dismiss(key);
}

export function pauseQueue(): void {
  ensureStarted();
  queue.pause();
}

export function resumeQueue(): void {
  ensureStarted();
  queue.resume();
}

export function resetNetworkStoreForTests(): void {
  monitor?.stop();
  monitor = null;
  queue.stop();
  queue = createWorkQueue(publishPendingKeys);
  started = false;
  store.setState({ isConnected: null, pendingKeys: [] });
}

/** Valor capturado al evaluar el módulo: importarlo no arranca el monitor. */
export const startedDuringModuleInit = started;
