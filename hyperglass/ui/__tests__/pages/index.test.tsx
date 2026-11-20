import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '~/__tests__/render';
import { useFormState } from '~/hooks';
import Index from '../../pages/index';

// This test lives outside `pages/`, because Next.js treats every file there as a page
// and `next build` fails on a test file.
//
// The page loads the form and the results through `next/dynamic`. Both components
// have their own tests; stub them so these tests cover which view the page picks.
// `next/dynamic` stays real, so each test waits for the import to resolve.
vi.mock('~/components/looking-glass-form', () => ({
  LookingGlassForm: () => <form aria-label="looking glass form" />,
}));
vi.mock('~/components/results', () => ({
  Results: () => <section aria-label="results" />,
}));

const initialFormState = useFormState.getState();

const form = {
  queryLocation: ['router_one'],
  queryTarget: ['192.0.2.0/24'],
  queryType: '__hyperglass_juniper_bgp_route__',
  queryVariables: {},
};

afterEach(() => {
  act(() => {
    useFormState.setState(initialFormState, true);
  });
});

describe('Index page', () => {
  it('shows the form on first load', async () => {
    renderWithProviders(<Index />);

    expect(await screen.findByRole('form', { name: 'looking glass form' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'results' })).not.toBeInTheDocument();
  });

  it('shows the results once a complete query is submitted', async () => {
    useFormState.setState({ form, status: 'results' });
    renderWithProviders(<Index />);

    expect(await screen.findByRole('region', { name: 'results' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'looking glass form' })).not.toBeInTheDocument();
  });

  it.each([
    ['location', { queryLocation: [] }],
    ['query type', { queryType: '' }],
    ['target', { queryTarget: [] }],
  ])('keeps the form while the query has no %s', async (_, missing) => {
    useFormState.setState({ form: { ...form, ...missing }, status: 'results' });
    renderWithProviders(<Index />);

    expect(await screen.findByRole('form', { name: 'looking glass form' })).toBeInTheDocument();
  });

  it('switches back to the form when the view returns to it', async () => {
    useFormState.setState({ form, status: 'results' });
    renderWithProviders(<Index />);
    await screen.findByRole('region', { name: 'results' });

    act(() => {
      useFormState.getState().setStatus('form');
    });

    expect(await screen.findByRole('form', { name: 'looking glass form' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'results' })).not.toBeInTheDocument();
  });
});
