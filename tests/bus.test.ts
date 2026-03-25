import { describe, it, expect, vi } from 'vitest';
import { TypedEventBus } from '../src/bus.js';

interface TestEvents {
  'test:hello': { name: string };
  'test:count': { n: number };
  'test:void': undefined;
}

describe('TypedEventBus', () => {
  it('emits events to listeners', async () => {
    const bus = new TypedEventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('test:hello', handler);
    await bus.emit('test:hello', { name: 'world' });
    expect(handler).toHaveBeenCalledWith({ name: 'world' });
  });

  it('supports multiple listeners', async () => {
    const bus = new TypedEventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('test:count', h1);
    bus.on('test:count', h2);
    await bus.emit('test:count', { n: 42 });
    expect(h1).toHaveBeenCalledWith({ n: 42 });
    expect(h2).toHaveBeenCalledWith({ n: 42 });
  });

  it('unsubscribe works', async () => {
    const bus = new TypedEventBus<TestEvents>();
    const handler = vi.fn();
    const unsub = bus.on('test:hello', handler);
    unsub();
    await bus.emit('test:hello', { name: 'nobody' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('errors in handlers do not propagate', async () => {
    const bus = new TypedEventBus<TestEvents>();
    const errorHandler = vi.fn(async () => { throw new Error('boom'); });
    const goodHandler = vi.fn();
    // Suppress the expected console.error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('test:count', errorHandler);
    bus.on('test:count', goodHandler);

    // Should not throw
    await bus.emit('test:count', { n: 1 });
    expect(goodHandler).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('handles events with no listeners', async () => {
    const bus = new TypedEventBus<TestEvents>();
    // Should not throw
    await bus.emit('test:void', undefined);
  });

  it('reports listener count', () => {
    const bus = new TypedEventBus<TestEvents>();
    expect(bus.listenerCount('test:hello')).toBe(0);
    bus.on('test:hello', () => {});
    expect(bus.listenerCount('test:hello')).toBe(1);
  });
});
