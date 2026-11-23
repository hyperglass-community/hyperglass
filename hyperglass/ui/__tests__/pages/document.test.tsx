// @ts-expect-error: the UI has no `@types/react-dom`, so `react-dom/server` is untyped.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/config.json';

// `_document` renders through Next.js's own document components, which need its render
// context; stand-ins render their children so the head's order can be checked.
vi.mock('next/document', async () => {
  const { Component } = await import('react');
  return {
    default: Component,
    Html: ({ children }: { children: React.ReactNode }) => <html lang="en">{children}</html>,
    Head: ({ children }: { children: React.ReactNode }) => <head>{children}</head>,
    Main: () => <main />,
    NextScript: () => null,
  };
});
// `_document` imports `hyperglass.json`, which must exist to be resolved (CI writes `{}`,
// as for the type check); its content here is the fixture.
vi.mock('../../hyperglass.json', () => ({ default: fixture, ...fixture }));

describe('Document', () => {
  it('sets a same-origin referrer policy before anything the page loads', async () => {
    // For a UI served by something other than Hyperglass, which sends the header (#560).
    const { default: MyDocument } = await import('../../pages/_document');
    const document = new MyDocument({
      fonts: {
        body: 'https://fonts.googleapis.com/css?family=Nunito',
        mono: 'https://fonts.googleapis.com/css?family=Fira+Code',
      },
      defaultColorMode: null,
      customJs: '',
      customHtml: '',
    } as never);
    const html = renderToStaticMarkup(document.render());

    const meta = html.indexOf('<meta name="referrer" content="same-origin"/>');
    expect(meta).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(html.indexOf('<link'));
    expect(meta).toBeLessThan(html.indexOf('<script'));
  });
});
