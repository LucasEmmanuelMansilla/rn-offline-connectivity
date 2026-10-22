export const EMISSION_GAP_MS = 50;

interface QueuedWork {
  key: string;
  run: () => void;
}

export interface WorkQueue {
  enqueue(run: () => void, key: string): void;
  dismiss(key: string): void;
  pause(): void;
  resume(): void;
  setConnected(isConnected: boolean | null): void;
  stop(): void;
}

export function createWorkQueue(onPendingKeys: (keys: string[]) => void): WorkQueue {
  let items: QueuedWork[] = [];
  let paused = false;
  let connected: boolean | null = null;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const publish = () => {
    onPendingKeys(items.map((item) => item.key));
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const canEmit = () => connected === true && !paused;

  const pump = (): boolean => {
    if (busy || timer !== null || !canEmit() || items.length === 0) {
      return false;
    }
    const item = items.shift();
    if (!item) {
      return false;
    }
    publish();
    busy = true;
    try {
      item.run();
    } catch {
      // Un fallo no se reencola ni se registra.
    } finally {
      busy = false;
    }
    if (items.length > 0 && canEmit()) {
      timer = setTimeout(() => {
        timer = null;
        pump();
      }, EMISSION_GAP_MS);
    }
    return true;
  };

  return {
    enqueue(run, key) {
      if (typeof run !== 'function' || typeof key !== 'string') {
        throw new Error('enqueue necesita una función y una clave de texto.');
      }
      items = [...items.filter((item) => item.key !== key), { run, key }];
      if (!pump()) {
        publish();
      }
    },
    dismiss(key) {
      if (typeof key !== 'string') {
        throw new Error('dismiss necesita una clave de texto.');
      }
      const next = items.filter((item) => item.key !== key);
      if (next.length === items.length) {
        return;
      }
      items = next;
      publish();
    },
    pause() {
      paused = true;
      clearTimer();
    },
    resume() {
      if (!paused) {
        return;
      }
      paused = false;
      pump();
    },
    setConnected(isConnected) {
      connected = isConnected;
      if (canEmit()) {
        pump();
        return;
      }
      clearTimer();
    },
    stop() {
      clearTimer();
      items = [];
      paused = true;
      connected = null;
      busy = false;
    },
  };
}
