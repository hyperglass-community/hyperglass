import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeConfig, renderWithProviders } from '~/__tests__/render';
import { ASPath, Communities, MonoField, Weight } from './fields';

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
