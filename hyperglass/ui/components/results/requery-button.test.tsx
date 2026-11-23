import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_WAIT, makeConfig, renderWithProviders } from '~/__tests__/render';
import { RequeryButton, RequeryCountdown, useRequeryCooldown } from './requery-button';

import type { RequeryOutcome } from '~/hooks/use-lg-query';

type Requery = () => Promise<unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Render the button and wait for its icon. The icon loads through `next/dynamic`, so
 * waiting for it makes every run cover the same code.
 */
async function renderButton(
  props: Partial<React.ComponentProps<typeof RequeryButton>> = {},
  options: Parameters<typeof renderWithProviders>[1] = {},
) {
  const requery = vi.fn() as unknown as Requery;
  const result = renderWithProviders(
    <RequeryButton requery={requery} data-testid="requery" {...props} />,
    options,
  );
  await waitFor(
    () => expect(result.container.querySelector('svg')).toBeInTheDocument(),
    IMPORT_WAIT,
  );
  return { ...result, requery, button: screen.getByTestId('requery') };
}

describe('RequeryButton', () => {
  it('runs the query again on click', async () => {
    const { button, requery } = await renderButton();

    await userEvent.click(button);

    expect(requery).toHaveBeenCalledTimes(1);
  });

  it('shows a tooltip on hover', async () => {
    const { button } = await renderButton();

    await userEvent.hover(button);

    expect(await screen.findByRole('tooltip', { name: 'Reload Query' })).toBeInTheDocument();
  });

  it('is marked disabled while a query runs', async () => {
    const { button } = await renderButton({ isDisabled: true });

    expect(button).toHaveAttribute('disabled');
  });

  // #510: as an `<a>`, `disabled` had no effect and a click while a query ran still
  // called `requery`.
  it('ignores clicks while disabled', async () => {
    const { button, requery } = await renderButton({ isDisabled: true });

    await userEvent.click(button);

    expect(requery).not.toHaveBeenCalled();
  });

  it('can be reached and pressed with the keyboard', async () => {
    const { button, requery } = await renderButton();

    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(requery).toHaveBeenCalledTimes(1);
  });

  it('forwards its ref to the button element', async () => {
    const ref = createRef<HTMLButtonElement>();
    const { button } = await renderButton({ ref });

    expect(ref.current).toBe(button);
  });

  // #533: the button's only content is an icon, and the tooltip text reaches assistive
  // technology only while the tooltip is open.
  it('is named by web.text.reloadQuery', async () => {
    const { button } = await renderButton();

    expect(screen.getByRole('button', { name: 'Reload Query' })).toBe(button);
  });

  it('keeps its name while disabled', async () => {
    const { button } = await renderButton({ isDisabled: true });

    expect(screen.getByRole('button', { name: 'Reload Query' })).toBe(button);
  });

  it('uses the configured text for its name and tooltip', async () => {
    const config = makeConfig({ web: { text: { reloadQuery: 'Relancer' } } });
    const { button } = await renderButton({}, { config });

    expect(screen.getByRole('button', { name: 'Relancer' })).toBe(button);
    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip', { name: 'Relancer' })).toBeInTheDocument();
  });
});

interface CooldownProps {
  requery(): Promise<RequeryOutcome>;
  refreshAt: number | null;
  isDisabled?: boolean;
}

/** How many times `WithCooldown` has rendered. */
let renders = 0;

/** The button with its cooldown, wired as `Result` wires them. */
const WithCooldown = (props: CooldownProps): JSX.Element => {
  const { requery, refreshAt, isDisabled } = props;
  const cooldown = useRequeryCooldown(requery, refreshAt);
  renders += 1;
  return (
    <>
      <RequeryButton
        requery={cooldown.requery}
        announcement={cooldown.announcement}
        isDisabled={isDisabled}
        data-testid="requery"
      />
      {cooldown.until !== null && (
        <RequeryCountdown key={cooldown.until} until={cooldown.until} data-testid="countdown" />
      )}
    </>
  );
};

describe('RequeryButton cooldown', () => {
  // The clock starts here once the button has rendered. The button's icon loads through
  // `next/dynamic` and Testing Library's `waitFor` polls with real timers, so the fake
  // timers (exact, not following the real clock) start only after that.
  const start = new Date('2026-11-20T08:00:00Z').getTime();

  afterEach(() => {
    vi.useRealTimers();
  });

  async function renderCooldown(
    props: Partial<CooldownProps> & { refreshAt: number | null },
    options: Parameters<typeof renderWithProviders>[1] = {},
  ) {
    const requery = props.requery ?? vi.fn(async () => ({ cached: false, refreshAt: null }));
    const result = renderWithProviders(<WithCooldown {...props} requery={requery} />, options);
    await waitFor(
      () => expect(result.container.querySelector('svg')).toBeInTheDocument(),
      IMPORT_WAIT,
    );
    vi.useFakeTimers();
    vi.setSystemTime(start);
    return { ...result, requery, button: screen.getByTestId('requery') };
  }

  /** The visible countdown, if any. */
  function countdown(): HTMLElement | null {
    return screen.queryByTestId('countdown');
  }

  /** The live region that announces the cooldown. */
  function liveRegion(): HTMLElement {
    return screen.getByRole('status');
  }

  function click(button: HTMLElement): void {
    act(() => {
      fireEvent.click(button);
    });
  }

  /** Advance the clock and let the countdown render. */
  function advance(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('runs the query when there is no cooldown', async () => {
    const { button, requery } = await renderCooldown({ refreshAt: null });

    click(button);

    expect(requery).toHaveBeenCalledTimes(1);
    expect(countdown()).toBeNull();
  });

  it('runs the query once the cooldown has ended', async () => {
    const { button, requery } = await renderCooldown({ refreshAt: start });

    click(button);

    expect(requery).toHaveBeenCalledTimes(1);
    expect(countdown()).toBeNull();
  });

  it('holds a press made 1 ms before the cooldown ends', async () => {
    const { button, requery } = await renderCooldown({ refreshAt: start + 1 });

    click(button);

    expect(requery).not.toHaveBeenCalled();
    expect(countdown()).toHaveTextContent('Refresh available in 1s');
    advance(1);
    expect(countdown()).toBeNull();
  });

  it('renders nothing visible when idle', async () => {
    // The live region is visually hidden and positioned out of the flow, so it adds no
    // space next to the button; the countdown is rendered only while it counts.
    const { container, button } = await renderCooldown({ refreshAt: start + 20_000 });

    expect(countdown()).toBeNull();
    const region = liveRegion();
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(getComputedStyle(region).position).toBe('absolute');
    expect(getComputedStyle(region).width).toBe('1px');
    // Chakra's hidden environment span aside, the button and the region are all there is.
    const others = Array.from(container.children).filter(
      element => !element.contains(button) && element !== region && !element.hasAttribute('hidden'),
    );
    expect(others).toEqual([]);
  });

  it('sends nothing during the cooldown and shows the time left', async () => {
    const { button, requery } = await renderCooldown({ refreshAt: start + 20_000 });

    click(button);

    expect(requery).not.toHaveBeenCalled();
    const text = countdown();
    expect(text).toHaveTextContent('Refresh available in 20s');
    expect(text).toBeVisible();
    // Screen readers get it from the live region instead, once per press.
    expect(text).toHaveAttribute('aria-hidden', 'true');
  });

  it('announces the time left once per press, not on every tick, then clears it', async () => {
    const { button } = await renderCooldown({ refreshAt: start + 20_000 });
    const region = liveRegion();

    click(button);
    expect(region).toBeEmptyDOMElement();
    advance(100);
    expect(region).toHaveTextContent('Refresh available in 20s');

    advance(900);
    expect(countdown()).toHaveTextContent('Refresh available in 19s');
    expect(region).toHaveTextContent('Refresh available in 20s');
    advance(1_000);
    expect(countdown()).toHaveTextContent('Refresh available in 18s');
    expect(region).toHaveTextContent('Refresh available in 20s');

    // Kept for 5 s, so a screen reader that queued it still reads it, then cleared so the
    // region holds no stale figure.
    advance(1_000);
    advance(1_000);
    advance(1_000);
    expect(region).toHaveTextContent('Refresh available in 20s');
    advance(200);
    expect(region).toBeEmptyDOMElement();
    expect(countdown()).toHaveTextContent('Refresh available in 15s');
  });

  it('clears the announcement when the cooldown ends', async () => {
    const { button } = await renderCooldown({ refreshAt: start + 2_000 });
    const region = liveRegion();

    click(button);
    advance(100);
    expect(region).toHaveTextContent('Refresh available in 2s');
    advance(1_899);
    expect(region).toHaveTextContent('Refresh available in 2s');
    advance(1);
    expect(region).toBeEmptyDOMElement();
    expect(countdown()).toBeNull();
  });

  it('does not re-render its user on each tick', async () => {
    // The ticks are the countdown's own state, so a large result under the hook's user
    // isn't rendered again every second.
    const { button } = await renderCooldown({ refreshAt: start + 20_000 });
    click(button);
    advance(200);
    const before = renders;

    // One tick per step: each tick schedules the next when it renders.
    advance(1_000);
    advance(1_000);
    advance(1_000);

    expect(countdown()).toHaveTextContent('Refresh available in 17s');
    expect(renders).toBe(before);
  });

  it('announces again on another press during the cooldown', async () => {
    const { button } = await renderCooldown({ refreshAt: start + 20_000 });
    const region = liveRegion();
    click(button);
    advance(100);
    expect(region).toHaveTextContent('Refresh available in 20s');

    // Cleared first, so the same text is set again as a change a screen reader reads.
    advance(400);
    click(button);
    expect(region).toBeEmptyDOMElement();
    advance(100);
    expect(region).toHaveTextContent('Refresh available in 20s');
  });

  it('stays enabled and keeps its name during the cooldown', async () => {
    const { button } = await renderCooldown({ refreshAt: start + 20_000 });

    click(button);

    expect(button).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reload Query' })).toBe(button);
  });

  it('counts down to zero and then removes the text', async () => {
    const { button, requery } = await renderCooldown({ refreshAt: start + 3_000 });

    click(button);
    expect(countdown()).toHaveTextContent('Refresh available in 3s');

    advance(1_000);
    expect(countdown()).toHaveTextContent('Refresh available in 2s');
    advance(1_000);
    expect(countdown()).toHaveTextContent('Refresh available in 1s');
    advance(1_000);
    expect(countdown()).toBeNull();
    expect(liveRegion()).toBeEmptyDOMElement();

    click(button);
    expect(requery).toHaveBeenCalledTimes(1);
  });

  it('ticks on the whole seconds of the time left', async () => {
    const { button } = await renderCooldown({ refreshAt: start + 2_400 });

    click(button);
    expect(countdown()).toHaveTextContent('Refresh available in 3s');
    advance(399);
    expect(countdown()).toHaveTextContent('Refresh available in 3s');
    advance(1);
    expect(countdown()).toHaveTextContent('Refresh available in 2s');
    advance(999);
    expect(countdown()).toHaveTextContent('Refresh available in 2s');
    advance(1);
    expect(countdown()).toHaveTextContent('Refresh available in 1s');
    advance(1_000);
    expect(countdown()).toBeNull();
  });

  it('keeps the live region in place before and after the countdown', async () => {
    // A live region added together with its text is often not announced, so it is
    // rendered empty from the start.
    const { button } = await renderCooldown({ refreshAt: start + 1_000 });
    const region = liveRegion();
    expect(region).toBeEmptyDOMElement();

    click(button);
    advance(100);
    expect(region).toHaveTextContent('Refresh available in 1s');
    advance(1_000);

    expect(liveRegion()).toBe(region);
    expect(region).toBeEmptyDOMElement();
  });

  it('uses the configured cooldown text', async () => {
    const config = makeConfig({
      web: { text: { refreshCooldown: 'Nouvel essai dans {seconds} s' } },
    });
    const { button } = await renderCooldown({ refreshAt: start + 9_000 }, { config });

    click(button);
    advance(100);

    expect(countdown()).toHaveTextContent('Nouvel essai dans 9 s');
    expect(liveRegion()).toHaveTextContent('Nouvel essai dans 9 s');
  });

  it('ignores clicks while disabled, even during the cooldown', async () => {
    const { button, requery } = await renderCooldown({
      refreshAt: start + 20_000,
      isDisabled: true,
    });

    click(button);
    advance(100);

    expect(requery).not.toHaveBeenCalled();
    expect(countdown()).toBeNull();
    expect(liveRegion()).toBeEmptyDOMElement();
  });

  it('shows the cooldown at once when a press is answered from the cache', async () => {
    // Another visitor's forced run started the server's cooldown, so this press got the
    // cached result and a `refresh_in` the button didn't know about.
    const requery = vi.fn(async () => ({ cached: true, refreshAt: start + 25_000 }));
    const { button } = await renderCooldown({ refreshAt: null, requery });

    click(button);
    await act(async () => {
      await Promise.resolve();
    });

    expect(requery).toHaveBeenCalledTimes(1);
    expect(countdown()).toHaveTextContent('Refresh available in 25s');
    advance(100);
    expect(liveRegion()).toHaveTextContent('Refresh available in 25s');
  });

  it('counts down a cooldown that starts as the previous one ends', async () => {
    const requery = vi.fn(async () => ({ cached: true, refreshAt: start + 3_000 }));
    const { button } = await renderCooldown({ refreshAt: start + 1_000, requery });
    click(button);
    advance(1_000);
    expect(countdown()).toBeNull();

    // Pressed at the same instant: answered from the cache with a new cooldown.
    click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(countdown()).toHaveTextContent('Refresh available in 2s');
    advance(1_000);
    expect(countdown()).toHaveTextContent('Refresh available in 1s');
  });

  it('shows nothing when a press is answered from the cache with an ended cooldown', async () => {
    const requery = vi.fn(async () => ({ cached: true, refreshAt: start }));
    const { button } = await renderCooldown({ refreshAt: null, requery });

    click(button);
    await act(async () => {
      await Promise.resolve();
    });
    advance(100);

    expect(countdown()).toBeNull();
    expect(liveRegion()).toBeEmptyDOMElement();
  });

  it('shows no cooldown after a press that ran the query', async () => {
    // A forced run that ran on the device starts a cooldown too; it is shown only if the
    // user presses again before it ends.
    const requery = vi.fn(async () => ({ cached: false, refreshAt: start + 30_000 }));
    const { button } = await renderCooldown({ refreshAt: null, requery });

    click(button);
    await act(async () => {
      await Promise.resolve();
    });
    advance(100);

    expect(countdown()).toBeNull();
    expect(liveRegion()).toBeEmptyDOMElement();
  });

  it('leaves no timers behind when unmounted during the cooldown', async () => {
    const { button, unmount } = await renderCooldown({ refreshAt: start + 20_000 });
    click(button);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts nothing when unmounted before a press is answered', async () => {
    let answer: (outcome: RequeryOutcome) => void = () => undefined;
    const requery = vi.fn(
      () =>
        new Promise<RequeryOutcome>(resolve => {
          answer = resolve;
        }),
    );
    const { button, unmount } = await renderCooldown({ refreshAt: null, requery });
    click(button);
    unmount();

    await act(async () => {
      answer({ cached: true, refreshAt: start + 25_000 });
      await Promise.resolve();
    });

    expect(vi.getTimerCount()).toBe(0);
  });
});
