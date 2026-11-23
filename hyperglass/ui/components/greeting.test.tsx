import { ChakraProvider } from '@chakra-ui/react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
// @ts-expect-error: the UI has no `@types/react-dom`, so `react-dom/server` is untyped.
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeConfig } from '~/__tests__/render';
import { makeTheme } from '~/util';

// The UI is a static export, so `Greeting` is prerendered with the store's defaults and
// then hydrated in the browser. During hydration, zustand 5 renders the store's initial
// (not yet rehydrated) state, so the first effect run sees `isAck: false` even for a
// visitor whose acknowledgement is stored. These tests hydrate prerendered markup, as
// the browser does; a plain `render()` reads the rehydrated state and can't catch this.

const STORAGE_KEY = 'hyperglass-greeting';
const config = makeConfig({ web: { greeting: { enable: true, required: true } } });

/** Prerender `Greeting` to a string and hydrate it, with fresh copies of the modules. */
async function hydrateGreeting() {
  const { HyperglassContext } = await import('~/context');
  const { Greeting } = await import('./greeting');
  const { useGreeting } = await import('~/hooks');
  const theme = makeTheme(config.web.theme, config.web.theme.defaultColorMode);
  const tree = (
    <HyperglassContext.Provider value={config}>
      <ChakraProvider theme={theme}>
        <Greeting />
      </ChakraProvider>
    </HyperglassContext.Provider>
  );
  const container = document.createElement('div');
  // Chakra's `useLayoutEffect` calls warn when rendered on the server; silence them.
  const serverWarnings = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container.innerHTML = renderToString(tree);
  serverWarnings.mockRestore();
  document.body.appendChild(container);
  // `hydrate: true` hydrates the markup with `hydrateRoot`, as the browser does.
  render(tree, { container, hydrate: true });
  return useGreeting;
}

/** The payload zustand 5's `persist` stores for a visitor who acknowledged the greeting. */
async function v5Payload(): Promise<string> {
  const { useGreeting } = await import('~/hooks');
  useGreeting.getState().ack(true, true);
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) {
    throw new Error('zustand did not store the greeting');
  }
  return stored;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('Greeting after hydration', () => {
  it.each([
    [
      'zustand 3',
      async () =>
        JSON.stringify({
          state: { isOpen: false, isAck: true, greetingReady: true },
          version: 0,
        }),
    ],
    ['zustand 5', v5Payload],
  ])('stays closed for a visitor whose acknowledgement %s stored', async (_, payload) => {
    const stored = await payload();
    vi.resetModules();
    localStorage.setItem(STORAGE_KEY, stored);

    const useGreeting = await hydrateGreeting();

    expect(useGreeting.getState()).toMatchObject({ isAck: true, isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens for a visitor who has not acknowledged it', async () => {
    const useGreeting = await hydrateGreeting();

    expect(useGreeting.getState()).toMatchObject({ isAck: false, isOpen: true });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });
});
