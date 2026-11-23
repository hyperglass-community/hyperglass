import { beforeEach, describe, expect, it, vi } from 'vitest';

// Visitors who acknowledged the greeting before the zustand 5 upgrade have it stored in
// localStorage in the format zustand 3.7.2's `persist` wrote: the whole state, without
// its functions, as `JSON.stringify({ state, version: 0 })`. The store has no `migrate`,
// so zustand 5 must read that payload as it is, or every visitor sees the greeting
// again. The store reads localStorage when it is created, at import, so each test seeds
// storage first and then imports a fresh copy of the module.

const STORAGE_KEY = 'hyperglass-greeting';

function storeV3Payload(state: Record<string, unknown>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('useGreeting rehydration', () => {
  it('restores an acknowledgement stored by zustand 3', async () => {
    storeV3Payload({ isOpen: false, isAck: true, greetingReady: true });
    const { useGreeting } = await import('./use-greeting');
    expect(useGreeting.getState()).toMatchObject({
      isOpen: false,
      isAck: true,
      greetingReady: true,
    });
  });

  it('keeps the defaults when nothing is stored', async () => {
    const { useGreeting } = await import('./use-greeting');
    expect(useGreeting.getState()).toMatchObject({
      isOpen: false,
      isAck: false,
      greetingReady: false,
    });
  });

  it('keeps the actions, which the stored state does not hold', async () => {
    storeV3Payload({ isOpen: false, isAck: true, greetingReady: true });
    const { useGreeting } = await import('./use-greeting');
    const { ack, open, close } = useGreeting.getState();
    expect(ack).toBeTypeOf('function');
    expect(open).toBeTypeOf('function');
    expect(close).toBeTypeOf('function');

    open();
    expect(useGreeting.getState().isOpen).toBe(true);
    ack(false, true);
    expect(useGreeting.getState()).toMatchObject({ isOpen: false, isAck: false });
  });
});
