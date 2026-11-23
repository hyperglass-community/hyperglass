import { devtools } from 'zustand/middleware';

import type { StateCreator } from 'zustand';

/**
 * Wrap a zustand state function with devtools, if applicable.
 *
 * @param store zustand store function.
 * @param name Store name.
 */
export function withDev<T extends object = {}>(
  store: StateCreator<T, [], []>,
  name: string,
): StateCreator<T, [], []> {
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    // The devtools mutator only adds an optional action-name argument to `set`, so
    // erasing it from the return type is safe and keeps the wrapper's type the same
    // whether or not devtools is applied.
    return devtools(store, { name }) as StateCreator<T, [], []>;
  }
  return store;
}
