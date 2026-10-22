import { createWorkQueue, EMISSION_GAP_MS } from './queue';

describe('cola en memoria', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function createQueue(connected: boolean | null = null) {
    let pendingKeys: string[] = [];
    const queue = createWorkQueue((keys) => {
      pendingKeys = keys;
    });
    queue.setConnected(connected);
    return {
      queue,
      keys: () => pendingKeys,
    };
  }

  it('retiene el trabajo si no hay acceso y lo ejecuta al haberlo', () => {
    const started: string[] = [];
    const offline = createQueue(false);
    offline.queue.enqueue(() => started.push('a'), 'a');
    expect(started).toEqual([]);
    expect(offline.keys()).toEqual(['a']);

    const unknown = createQueue(null);
    unknown.queue.enqueue(() => started.push('b'), 'b');
    expect(started).toEqual([]);
    expect(unknown.keys()).toEqual(['b']);

    unknown.queue.setConnected(true);
    expect(started).toEqual(['b']);
    expect(unknown.keys()).toEqual([]);
  });

  it('separa los inicios 50 ms y conserva el orden', () => {
    expect(EMISSION_GAP_MS).toBe(50);
    const started: string[] = [];
    const { queue, keys } = createQueue(false);
    queue.enqueue(() => started.push('a'), 'a');
    queue.enqueue(() => started.push('b'), 'b');
    queue.enqueue(() => started.push('c'), 'c');
    queue.setConnected(true);

    expect(started).toEqual(['a']);
    expect(keys()).toEqual(['b', 'c']);
    jest.advanceTimersByTime(49);
    expect(started).toEqual(['a']);
    jest.advanceTimersByTime(1);
    expect(started).toEqual(['a', 'b']);
    jest.advanceTimersByTime(50);
    expect(started).toEqual(['a', 'b', 'c']);
    expect(keys()).toEqual([]);
  });

  it('una clave repetida deja la función nueva al final', () => {
    const started: string[] = [];
    const { queue, keys } = createQueue(false);
    queue.enqueue(() => started.push('vieja'), 'a');
    queue.enqueue(() => started.push('b'), 'b');
    queue.enqueue(() => started.push('nueva'), 'a');
    expect(keys()).toEqual(['b', 'a']);

    queue.setConnected(true);
    jest.advanceTimersByTime(50);
    expect(started).toEqual(['b', 'nueva']);
  });

  it('dismiss evita la ejecución y la pausa retiene el resto', () => {
    const started: string[] = [];
    const { queue, keys } = createQueue(false);
    queue.enqueue(() => started.push('a'), 'a');
    queue.enqueue(() => started.push('b'), 'b');
    queue.enqueue(() => started.push('c'), 'c');
    queue.dismiss('b');
    expect(keys()).toEqual(['a', 'c']);

    queue.setConnected(true);
    queue.pause();
    jest.advanceTimersByTime(200);
    expect(started).toEqual(['a']);
    expect(keys()).toEqual(['c']);

    queue.resume();
    expect(started).toEqual(['a', 'c']);
  });

  it('una función que lanza no se reencola ni se registra', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const started: string[] = [];
    const { queue, keys } = createQueue(false);
    queue.enqueue(() => {
      throw new Error('fallo interno');
    }, 'rota');
    queue.enqueue(() => started.push('siguiente'), 'siguiente');
    queue.setConnected(true);

    expect(keys()).toEqual(['siguiente']);
    jest.advanceTimersByTime(50);
    expect(started).toEqual(['siguiente']);
    expect(keys()).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
