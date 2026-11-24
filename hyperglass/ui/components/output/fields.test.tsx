import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeConfig, renderWithProviders } from '~/__tests__/render';
import { ASPath, Age, Communities, MonoField, Weight } from './fields';

/** Tab to the only focusable element and return the tooltip element it opens. */
async function tooltipOnFocus(): Promise<HTMLElement> {
  await userEvent.tab();
  return waitFor(() => screen.getByRole('tooltip'));
}

describe('ASPath', () => {
  it('names the marker of a locally originated route with web.text.as_path_internal (#581)', () => {
    renderWithProviders(<ASPath path={[]} active={false} />, {
      config: makeConfig({ web: { text: { asPathInternal: 'Interne' } } }),
    });

    expect(screen.getByRole('img', { name: 'Interne' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Internal' })).not.toBeInTheDocument();
  });

  it('shows the marker text to keyboard users, without hover (#581)', async () => {
    renderWithProviders(<ASPath path={[]} active={false} />, {
      config: makeConfig({ web: { text: { asPathInternal: 'Interne' } } }),
    });

    const tooltip = await tooltipOnFocus();

    expect(screen.getByRole('img', { name: 'Interne' })).toHaveFocus();
    expect(tooltip).toHaveTextContent('Interne');
  });

  it('labels an ASN without an organisation with web.text.as_path_asn (#581)', async () => {
    renderWithProviders(<ASPath path={[13335]} active={false} />, {
      config: makeConfig({ web: { text: { asPathAsn: 'Système autonome {asn}' } } }),
    });

    const tooltip = await tooltipOnFocus();

    expect(screen.getByRole('link', { name: '13335' })).toHaveFocus();
    expect(tooltip).toHaveTextContent('Système autonome 13335');
  });

  it('shows a malformed web.text.as_path_asn as written instead of failing', async () => {
    renderWithProviders(<ASPath path={[13335]} active={false} />, {
      config: makeConfig({ web: { text: { asPathAsn: '{} {asn}' } } }),
    });

    expect(await tooltipOnFocus()).toHaveTextContent('{} {asn}');
  });
});

describe('Marker', () => {
  it('keeps the tooltip open when the marker is clicked or tapped (#581)', async () => {
    renderWithProviders(<ASPath path={[]} active={false} />, {
      config: makeConfig({ web: { text: { asPathInternal: 'Interne' } } }),
    });
    const marker = screen.getByRole('img', { name: 'Interne' });

    await userEvent.click(marker);

    expect(marker).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Interne');
    // With `closeOnClick` on, the click closes it; wait out the exit animation.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Interne');
  });
});

describe('Communities', () => {
  it('names the no communities marker and shows it to keyboard users (#581)', async () => {
    renderWithProviders(<Communities communities={[]} />, {
      config: makeConfig({ web: { text: { noCommunities: 'Aucune communauté' } } }),
    });

    const tooltip = await tooltipOnFocus();

    expect(screen.getByRole('img', { name: 'Aucune communauté' })).toHaveFocus();
    expect(tooltip).toHaveTextContent('Aucune communauté');
  });
});

describe('MonoField', () => {
  it('shows web.text.no_value for an empty value (#581)', () => {
    renderWithProviders(<MonoField v="" />, {
      config: makeConfig({ web: { text: { noValue: 'n. d.' } } }),
    });

    expect(screen.getByText('n. d.')).toBeInTheDocument();
  });

  it('shows a zero', () => {
    renderWithProviders(<MonoField v={0} />);

    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

describe('Weight', () => {
  it.each([
    ['low', 'Poids faible préféré'],
    ['high', 'Poids fort préféré'],
  ] as const)('explains a %s winning weight with web.text (#581)', async (winning, label) => {
    renderWithProviders(<Weight weight={100} winningWeight={winning} />, {
      config: makeConfig({
        web: {
          text: {
            weightLowPreferred: 'Poids faible préféré',
            weightHighPreferred: 'Poids fort préféré',
          },
        },
      }),
    });

    await userEvent.hover(screen.getByText('100'));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(label);
  });
});

describe('Weight tooltip', () => {
  it('opens on keyboard focus and names the weight with it (#605)', async () => {
    renderWithProviders(<Weight weight={100} winningWeight="high" />, {
      config: makeConfig({ web: { text: { weightHighPreferred: 'Poids fort préféré' } } }),
    });

    const tooltip = await tooltipOnFocus();
    const weight = screen.getByText('100');

    expect(weight).toHaveFocus();
    expect(tooltip).toHaveTextContent('Poids fort préféré');
    expect(weight).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('stays open when the weight is tapped (#605)', async () => {
    renderWithProviders(<Weight weight={100} winningWeight="low" />);
    const weight = screen.getByText('100');

    await userEvent.click(weight);

    expect(weight).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});

describe('Age', () => {
  // 2026-11-24 10:00:00 UTC; the route was learned two hours before.
  const NOW = Date.UTC(2026, 10, 24, 10, 0, 0);
  const TWO_HOURS = 2 * 60 * 60;

  /** The absolute time the tooltip should show, formatted independently of the code. */
  function expected(locale: string): string {
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'long',
    }).format(new Date(NOW - TWO_HOURS * 1000));
  }

  beforeEach(() => {
    // Only `Date` is faked, so the tooltip's timers and user events still run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is English by default, as before (#605)', async () => {
    renderWithProviders(<Age inSeconds={TWO_HOURS} />);

    const tooltip = await tooltipOnFocus();

    expect(screen.getByText('2 hours')).toHaveFocus();
    expect(tooltip).toHaveTextContent(expected('en'));
    expect(tooltip).toHaveTextContent('UTC');
  });

  it('follows web.locale for the age and the time in its tooltip (#605)', async () => {
    renderWithProviders(<Age inSeconds={TWO_HOURS} />, {
      config: makeConfig({ web: { locale: 'fr' } }),
    });

    // The French dayjs locale loads on demand; English is shown until it has.
    const age = await screen.findByText('2 heures');
    const tooltip = await tooltipOnFocus();

    expect(age).toHaveFocus();
    expect(tooltip).toHaveTextContent(expected('fr'));
    expect(expected('fr')).not.toBe(expected('en'));
  });

  it('uses the language of a region dayjs has no locale for (#605)', async () => {
    renderWithProviders(<Age inSeconds={TWO_HOURS} />, {
      config: makeConfig({ web: { locale: 'de-LU' } }),
    });

    expect(await screen.findByText('2 Stunden')).toBeInTheDocument();
  });

  it('opens its tooltip when tapped and keeps it open (#605)', async () => {
    renderWithProviders(<Age inSeconds={TWO_HOURS} />);
    const age = screen.getByText('2 hours');

    await userEvent.click(age);

    expect(age).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(expected('en'));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(screen.getByRole('tooltip')).toHaveTextContent(expected('en'));
  });

  it('is hidden when the age is unknown', () => {
    const { container } = renderWithProviders(<Age inSeconds={-1} />);

    expect(container).toHaveTextContent('');
    expect(container.querySelector('[tabindex]')).toBeNull();
  });
});
