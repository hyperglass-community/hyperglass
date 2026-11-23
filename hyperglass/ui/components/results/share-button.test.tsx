import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders, testConfig } from '~/__tests__/render';
import { formatTimestamp } from '~/util';
import { ShareButton } from './share-button';

import type { Mock } from 'vitest';
import type { ShareLink } from '~/hooks/use-share-links';
import type { Config } from '~/types';

const QUERY_ID = `hyperglass.query.${'cd'.repeat(32)}`;
const SHARE_ID = 'fedcba9876543210fedcba9876543210';
const TOKEN = 'D3l3t3T0k3n_n3v3r-1n-th3-l1nk-0r-l0gs-abcdefg';
const DAY = 86400;
const EXPIRES = '2026-12-23T08:00:00Z';
/** The `timestamp` of the result shown, and of a later run of the same query. */
const TS = '2026-11-23 08:00:00';
const LATER = '2026-11-23 08:05:00';
/** A `POST /api/share` answer. */
const created = { id: SHARE_ID, expiresAt: EXPIRES, deleteToken: TOKEN };
const LINK = `${window.location.origin}${window.location.pathname}?share=${SHARE_ID}`;

/** A link as the button keeps it, live for a day unless overridden. */
function stored(overrides: Partial<ShareLink> = {}): ShareLink {
  return { ...created, deadline: Date.now() + DAY * 1000, timestamp: TS, ...overrides };
}

const enabled = (overrides: Parameters<typeof makeConfig>[0] = {}): Config =>
  makeConfig({ share: { enable: true }, ...overrides });

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

/** Replace `navigator.clipboard`; `undefined` removes it, as outside a secure context. */
function setClipboard(clipboard: Partial<Clipboard> | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

/** A `fetch` stub giving the answers in turn, the last one again once they run out. */
function stubFetch(...answers: Answer[]) {
  let call = 0;
  const impl = vi.fn(async (_url: string, _init?: RequestInit) => {
    const { status, body = {}, headers = {} } = answers[Math.min(call, answers.length - 1)];
    call += 1;
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  });
  vi.stubGlobal('fetch', impl);
  return impl;
}

let onAdd: Mock<(link: ShareLink) => void>;
let onRemove: Mock<(id: string) => void>;
let consoleCalls: ReturnType<typeof vi.spyOn>[];
let alert: ReturnType<typeof vi.fn>;
let prompt: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onAdd = vi.fn();
  onRemove = vi.fn();
  alert = vi.fn();
  prompt = vi.fn();
  vi.stubGlobal('alert', alert);
  vi.stubGlobal('prompt', prompt);
  consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level =>
    vi.spyOn(console, level),
  );
});

afterEach(() => {
  // The token is never logged, whatever happened in the test.
  for (const spy of consoleCalls) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  }
});

/** The button with its links kept in state, as a result's wrapper keeps them. */
const Harness = (props: { initial: ShareLink[]; timestamp: string }): JSX.Element => {
  const [links, setLinks] = useState(props.initial);
  return (
    <ShareButton
      queryId={QUERY_ID}
      timestamp={props.timestamp}
      links={links}
      onAdd={link => {
        onAdd(link);
        setLinks(current => [...current.filter(l => l.id !== link.id), link]);
      }}
      onRemove={id => {
        onRemove(id);
        setLinks(current => current.filter(l => l.id !== id));
      }}
    />
  );
};

async function renderButton(
  options: { config?: Config; initial?: ShareLink[]; timestamp?: string } = {},
) {
  const { config = enabled(), initial = [], timestamp = TS } = options;
  const result = renderWithProviders(<Harness initial={initial} timestamp={timestamp} />, {
    config,
  });
  const trigger = screen.getByRole('button', { name: config.web.text.shareResult });
  await waitFor(() => expect(trigger.querySelector('svg')).toBeInTheDocument(), IMPORT_WAIT);
  /** Render the same button for another result of the query, as after a forced refresh. */
  const requery = (next: string) => result.rerender(<Harness initial={initial} timestamp={next} />);
  return { trigger, container: result.container, requery };
}

async function open(trigger: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(trigger);
  return screen.findByRole('dialog');
}

const keepFor = (): HTMLSelectElement => screen.getByRole('combobox', { name: 'Keep for' });
const createButton = (): HTMLElement => screen.getByRole('button', { name: 'Create Link' });
const linkField = (): HTMLInputElement =>
  screen.getByRole('textbox', { name: 'Link to this result' });
const status = (): HTMLElement => within(screen.getByRole('dialog')).getByRole('status');
const earlierField = (): HTMLInputElement =>
  screen.getByRole('textbox', { name: `Link to the result from ${formatTimestamp(TS)}` });

/** Everything a visitor or another script could read off the page. */
function pageText(): string {
  const fields = Array.from(document.querySelectorAll('input')).map(i => i.value);
  return [document.body.innerHTML, ...fields, window.location.href, document.cookie].join(' ');
}

/** Open the popover and create a link with the default time. */
async function createLink(trigger: HTMLElement): Promise<void> {
  await open(trigger);
  await userEvent.click(createButton());
  await waitFor(() => expect(linkField()).toBeInTheDocument());
}

describe('ShareButton', () => {
  describe('the button', () => {
    it('is a native button named and labelled from web.text, opening a dialog', async () => {
      const { trigger } = await renderButton();
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      await userEvent.hover(trigger);
      expect(await screen.findByRole('tooltip', { name: 'Share Result' })).toBeInTheDocument();

      const dialog = await open(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(dialog).toHaveAccessibleName('Share Result');
    });

    it('uses the configured text', async () => {
      const config = enabled({
        web: {
          text: {
            shareResult: 'Partager',
            shareKeepFor: 'Garder',
            shareCreate: 'Créer',
            shareDays: '{count} jours',
          },
        },
      });
      const { trigger } = await renderButton({ config });
      expect(trigger).toHaveAccessibleName('Partager');
      await open(trigger);
      const select = screen.getByRole('combobox', { name: 'Garder' });
      expect(within(select).getByRole('option', { name: '30 jours' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Créer' })).toBeInTheDocument();
    });

    it('opens with Enter and closes with Escape, moving focus in and back', async () => {
      const { trigger } = await renderButton();
      trigger.focus();
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('dialog');
      await waitFor(() => expect(keepFor()).toHaveFocus());

      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(trigger).toHaveFocus());
      // Focus coming back doesn't open the tooltip over the content.
      await act(() => new Promise(resolve => setTimeout(resolve, 300)));
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('has no button with fixed English text', async () => {
      const { trigger } = await renderButton({ initial: [stored()] });
      const dialog = await open(trigger);
      const names = within(dialog)
        .getAllByRole('button')
        .map(b => b.getAttribute('aria-label') ?? b.textContent);
      expect(names).toEqual(['Copy Link', 'Delete Link']);
    });

    it('makes no request until a link is created', async () => {
      const fetch = stubFetch({ status: 201, body: created });
      const { trigger } = await renderButton();
      await open(trigger);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('keep for', () => {
    it('offers the configured choices, with share.timeout selected', async () => {
      const { trigger } = await renderButton();
      await open(trigger);
      const options = within(keepFor()).getAllByRole('option') as HTMLOptionElement[];
      expect(options.map(o => [o.value, o.textContent])).toEqual([
        ['604800', '7 days'],
        ['2592000', '30 days'],
        ['7776000', '90 days'],
      ]);
      expect(keepFor()).toHaveValue(String(testConfig.share.timeout));
    });

    it('offers only the choices of another configuration', async () => {
      const config = enabled({
        share: { enable: true, timeout: 3600, timeoutChoices: [600, 3600] },
      });
      const { trigger } = await renderButton({ config });
      await open(trigger);
      const options = within(keepFor()).getAllByRole('option') as HTMLOptionElement[];
      expect(options.map(o => o.textContent)).toEqual(['10 minutes', '1 hour']);
      expect(keepFor()).toHaveValue('3600');
    });

    it.each([604800, 2592000, 7776000])(
      'creates the link with expiresIn %i when it is chosen',
      async expiresIn => {
        const fetch = stubFetch({ status: 201, body: created });
        const { trigger } = await renderButton();
        await open(trigger);
        await userEvent.selectOptions(keepFor(), String(expiresIn));
        await userEvent.click(createButton());
        await waitFor(() => expect(linkField()).toBeInTheDocument());

        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/api/share');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ queryId: QUERY_ID, expiresIn });
      },
    );
  });

  describe('a created link', () => {
    it('shows the link, focused and selected, with its expiry and the notice', async () => {
      stubFetch({ status: 201, body: created });
      const select = vi.spyOn(HTMLInputElement.prototype, 'setSelectionRange');
      const { trigger } = await renderButton();
      const before = window.location.href;
      await createLink(trigger);

      const field = linkField();
      expect(field).toHaveValue(LINK);
      expect(field).toHaveAttribute('readonly');
      await waitFor(() => expect(field).toHaveFocus());
      expect(select).toHaveBeenCalledWith(0, LINK.length);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent(`Link expires ${formatTimestamp(EXPIRES)}`);
      expect(dialog).toHaveTextContent(
        'Anyone with the link can see this result, including the target.',
      );
      expect(dialog).toHaveTextContent(
        'You can delete the link from this page until you close or reload it.',
      );
      expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ ...created, timestamp: TS }));
      expect(window.location.href).toBe(before);
    });

    it('never puts the delete token on the page, in the link or in the address', async () => {
      stubFetch({ status: 201, body: created });
      const { trigger } = await renderButton();
      await createLink(trigger);

      expect(linkField().value).not.toContain(TOKEN);
      expect(pageText()).not.toContain(TOKEN);
    });

    it('shows a link given to it without a request, as from a saved entry', async () => {
      const fetch = stubFetch({ status: 201, body: created });
      const { trigger } = await renderButton({ initial: [stored()] });
      await open(trigger);
      expect(linkField()).toHaveValue(LINK);
      await waitFor(() => expect(linkField()).toHaveFocus());
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('forgets a link given to it that has expired', async () => {
      const { trigger } = await renderButton({ initial: [stored({ deadline: Date.now() - 1 })] });
      await waitFor(() => expect(onRemove).toHaveBeenCalledWith(SHARE_ID));
      await open(trigger);
      expect(keepFor()).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('never shows an expired link, even when the parent keeps passing it', async () => {
      const fetch = stubFetch({ status: 201, body: created });
      renderWithProviders(
        <ShareButton
          queryId={QUERY_ID}
          timestamp={TS}
          links={[stored({ deadline: Date.now() - 1 })]}
          onAdd={onAdd}
          onRemove={onRemove}
        />,
        { config: enabled() },
      );
      await open(screen.getByRole('button', { name: 'Share Result' }));
      expect(keepFor()).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete Link' })).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("shows a link whose expiry is in this browser's past when the server says it is live", async () => {
      // This browser's clock is a year ahead of the server's.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.parse('2027-11-23T08:00:00Z'));
      try {
        stubFetch({
          status: 201,
          body: created,
          headers: { date: 'Mon, 23 Nov 2026 08:00:00 GMT' },
        });
        const { trigger } = await renderButton();
        await createLink(trigger);
        expect(linkField()).toHaveValue(LINK);
        // The expiry the server gave, in the viewer's time zone.
        expect(screen.getByRole('dialog')).toHaveTextContent(
          `Link expires ${formatTimestamp(EXPIRES)}`,
        );
        expect(onRemove).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('forgets a link when it expires while the popover is open, and says so', async () => {
      const { trigger } = await renderButton({
        initial: [stored({ deadline: Date.now() + 1500 })],
      });
      await open(trigger);
      await waitFor(() => expect(linkField()).toHaveFocus());

      await waitFor(() => expect(onRemove).toHaveBeenCalledWith(SHARE_ID), { timeout: 4000 });
      await waitFor(() => expect(status()).toHaveTextContent('The link has expired.'));
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      // Focus stays in the popover.
      await waitFor(() => expect(keepFor()).toHaveFocus());
    });
  });

  describe('a later result of the same query', () => {
    it('still offers the link to the earlier result, to copy or delete', async () => {
      const writeText = vi.fn(async () => undefined);
      setClipboard({ writeText });
      const fetch = stubFetch({ status: 204 });
      const { trigger } = await renderButton({ initial: [stored()], timestamp: LATER });
      await open(trigger);

      // The later result has no link yet: it can get its own.
      expect(keepFor()).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Link to this result' })).toBeNull();
      expect(earlierField()).toHaveValue(LINK);

      await userEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
      expect(writeText).toHaveBeenCalledWith(LINK);
      await userEvent.click(screen.getByRole('button', { name: 'Delete Link' }));
      await waitFor(() => expect(onRemove).toHaveBeenCalledWith(SHARE_ID));
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/share/${SHARE_ID}`);
      expect(new Headers(init.headers).get('X-Delete-Token')).toBe(TOKEN);
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('keeps the link to the earlier result after a requery, next to a new one', async () => {
      const other = 'abcdefabcdefabcdefabcdefabcdefab';
      stubFetch({ status: 201, body: created }, { status: 201, body: { ...created, id: other } });
      const { trigger, requery } = await renderButton();
      await createLink(trigger);
      requery(LATER);

      await waitFor(() => expect(earlierField()).toHaveValue(LINK));
      await userEvent.click(createButton());
      await waitFor(() =>
        expect(linkField()).toHaveValue(
          `${window.location.origin}${window.location.pathname}?share=${other}`,
        ),
      );
      expect(earlierField()).toHaveValue(LINK);
    });

    it('files a link created while the query ran again under the result it was made from', async () => {
      let release: () => void = () => undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>(resolve => {
              release = () => resolve(new Response(JSON.stringify(created), { status: 201 }));
            }),
        ),
      );
      const { trigger, requery } = await renderButton();
      await open(trigger);
      await userEvent.click(createButton());
      requery(LATER);
      await act(async () => release());

      await waitFor(() =>
        expect(onAdd).toHaveBeenCalledWith(
          expect.objectContaining({ id: SHARE_ID, timestamp: TS }),
        ),
      );
      expect(earlierField()).toHaveValue(LINK);
      expect(keepFor()).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Link to this result' })).toBeNull();
    });
  });

  describe('copy', () => {
    it('copies the link and announces it', async () => {
      stubFetch({ status: 201, body: created });
      const writeText = vi.fn(async () => undefined);
      setClipboard({ writeText });
      const { trigger } = await renderButton();
      await createLink(trigger);

      expect(status()).toBeEmptyDOMElement();
      await userEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
      expect(writeText).toHaveBeenCalledWith(LINK);
      await waitFor(() => expect(status()).toHaveTextContent('Link copied'));
    });

    it.each([
      ['there is no clipboard', undefined],
      [
        'the clipboard refuses',
        {
          writeText: vi.fn(async () => {
            throw new DOMException('denied', 'NotAllowedError');
          }),
        },
      ],
    ])('selects the link in its field to copy by hand when %s', async (_, clipboard) => {
      stubFetch({ status: 201, body: created });
      setClipboard(clipboard);
      // Before the field exists: user-event wraps a field's own `setSelectionRange` once
      // it handles it, around the method it finds then.
      const select = vi.spyOn(HTMLInputElement.prototype, 'setSelectionRange');
      const { trigger } = await renderButton();
      await createLink(trigger);
      const copy = screen.getByRole('button', { name: 'Copy Link' });
      copy.focus();
      expect(linkField()).not.toHaveFocus();
      select.mockClear();

      await userEvent.click(copy);
      await waitFor(() => expect(linkField()).toHaveFocus());
      expect(select).toHaveBeenCalledWith(0, LINK.length);
      expect(status()).not.toHaveTextContent('Link copied');
      expect(alert).not.toHaveBeenCalled();
      expect(prompt).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes the link with its token in a header, and forgets the token', async () => {
      const fetch = stubFetch({ status: 201, body: created }, { status: 204 });
      const { trigger } = await renderButton();
      await createLink(trigger);

      await userEvent.click(screen.getByRole('button', { name: 'Delete Link' }));
      await waitFor(() => expect(status()).toHaveTextContent('Link deleted'));

      expect(fetch).toHaveBeenCalledTimes(2);
      const [url, init] = fetch.mock.calls[1] as [string, RequestInit];
      expect(url).toBe(`/api/share/${SHARE_ID}`);
      expect(init.method).toBe('DELETE');
      expect(new Headers(init.headers).get('X-Delete-Token')).toBe(TOKEN);
      // The token went nowhere else: not in the create request, not in a URL.
      const [, createInit] = fetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.stringify(createInit)).not.toContain(TOKEN);
      expect(fetch.mock.calls.map(([u]) => u).join(' ')).not.toContain(TOKEN);

      expect(onRemove).toHaveBeenCalledWith(SHARE_ID);
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      await waitFor(() => expect(keepFor()).toHaveFocus());
      expect(pageText()).not.toContain(TOKEN);
    });

    it('forgets a link the server no longer has, with the configured message', async () => {
      // The delete gets 404, and so does the read that follows it.
      const fetch = stubFetch({ status: 404, body: { output: 'server text' } });
      const { trigger } = await renderButton({ initial: [stored()] });
      await open(trigger);
      await userEvent.click(screen.getByRole('button', { name: 'Delete Link' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(testConfig.messages.shareNotFound);
      expect(onRemove).toHaveBeenCalledWith(SHARE_ID);
      expect(keepFor()).toBeInTheDocument();
      expect(screen.queryByText('server text')).not.toBeInTheDocument();
      expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['DELETE', 'GET']);
    });

    it('keeps a link that still exists when its token was replaced elsewhere', async () => {
      // Shared again from another page by the same client: this token is no longer valid.
      const fetch = stubFetch({ status: 404 }, { status: 200, body: { id: SHARE_ID } });
      const { trigger } = await renderButton({ initial: [stored()] });
      await open(trigger);
      await userEvent.click(screen.getByRole('button', { name: 'Delete Link' }));

      await waitFor(() =>
        expect(screen.getByRole('dialog')).toHaveTextContent(
          "This link can't be deleted from this page any more: the result was shared again elsewhere. It works until it expires.",
        ),
      );
      expect(linkField()).toHaveValue(LINK);
      await waitFor(() => expect(linkField()).toHaveFocus());
      expect(screen.queryByRole('button', { name: 'Delete Link' })).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onRemove).not.toHaveBeenCalled();
      // The useless token is dropped.
      expect(onAdd).toHaveBeenCalledWith(
        expect.objectContaining({ id: SHARE_ID, deleteToken: null }),
      );
      const [, read] = fetch.mock.calls[1] as [string, RequestInit];
      expect(read.method).toBe('GET');
      expect(JSON.stringify(read)).not.toContain(TOKEN);
      expect(screen.getByRole('dialog')).not.toHaveTextContent(
        'You can delete the link from this page until you close or reload it.',
      );
    });

    it('keeps the link when deleting is rate limited', async () => {
      const fetch = stubFetch({ status: 429 });
      const { trigger } = await renderButton({ initial: [stored()] });
      await open(trigger);
      await userEvent.click(screen.getByRole('button', { name: 'Delete Link' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(testConfig.messages.rateLimited);
      expect(onRemove).not.toHaveBeenCalled();
      expect(onAdd).not.toHaveBeenCalled();
      expect(linkField()).toHaveValue(LINK);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('keeps the link and its token when deleting fails', async () => {
      const fetch = stubFetch({ status: 500 }, { status: 204 });
      const { trigger } = await renderButton({ initial: [stored()] });
      await open(trigger);
      await userEvent.click(screen.getByRole('button', { name: 'Delete Link' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(testConfig.messages.general);
      expect(onRemove).not.toHaveBeenCalled();

      // The same token works on a second try.
      await userEvent.click(screen.getByRole('button', { name: 'Delete Link' }));
      await waitFor(() => expect(onRemove).toHaveBeenCalledWith(SHARE_ID));
      const [, retry] = fetch.mock.calls[1] as [string, RequestInit];
      expect(new Headers(retry.headers).get('X-Delete-Token')).toBe(TOKEN);
    });
  });

  describe('errors', () => {
    it.each([
      [404, testConfig.messages.shareResultExpired],
      [409, testConfig.messages.sharePending],
      [403, testConfig.messages.shareNotAllowed],
      [413, testConfig.messages.shareTooLarge],
      [400, testConfig.messages.shareInvalidExpiry],
      [503, testConfig.messages.shareUnavailable],
      [500, testConfig.messages.general],
    ])('shows the configured message for HTTP %i, never the response', async (code, message) => {
      stubFetch({ status: code, body: { output: '<i>from the server</i>', level: 'danger' } });
      const { trigger } = await renderButton();
      await open(trigger);
      await userEvent.click(createButton());

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('dialog')).not.toHaveTextContent('from the server');
      expect(onAdd).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('shows rate_limited for HTTP 429 and does not retry', async () => {
      const fetch = stubFetch({ status: 429 });
      const { trigger } = await renderButton();
      await open(trigger);
      await userEvent.click(createButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(testConfig.messages.rateLimited);
      // Nothing retries on its own (a react-query mutation or retry loop would within this).
      await act(() => new Promise(resolve => setTimeout(resolve, 1500)));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(createButton()).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('sends one request per press, and none while one is running', async () => {
      let release: () => void = () => undefined;
      const fetch = vi.fn(
        () =>
          new Promise<Response>(resolve => {
            release = () => resolve(new Response(JSON.stringify(created), { status: 201 }));
          }),
      );
      vi.stubGlobal('fetch', fetch);
      const { trigger } = await renderButton();
      await open(trigger);
      await userEvent.click(createButton());
      expect(createButton()).toHaveAttribute('aria-disabled', 'true');
      expect(createButton()).toHaveAttribute('aria-busy', 'true');
      await userEvent.click(createButton());
      expect(fetch).toHaveBeenCalledTimes(1);
      await act(async () => release());
      await waitFor(() => expect(linkField()).toBeInTheDocument());
    });

    it('clears the error when another time is chosen', async () => {
      stubFetch({ status: 503 });
      const { trigger } = await renderButton();
      await open(trigger);
      await userEvent.click(createButton());
      await screen.findByRole('alert');
      await userEvent.selectOptions(keepFor(), '604800');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('clears the error when the popover is closed', async () => {
      stubFetch({ status: 503 });
      const { trigger } = await renderButton();
      await open(trigger);
      await userEvent.click(createButton());
      await screen.findByRole('alert');
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await open(trigger);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
