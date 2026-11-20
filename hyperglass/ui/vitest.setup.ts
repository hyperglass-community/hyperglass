import '@testing-library/jest-dom/vitest';

// jsdom has no `matchMedia`. Chakra UI's color mode provider calls it when the theme
// follows the system color scheme, as the app's configuration does. Answer "no match"
// for every query, which is what a browser with no preference reports.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
