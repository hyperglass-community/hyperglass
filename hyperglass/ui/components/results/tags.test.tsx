import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders, testConfig } from '~/__tests__/render';
import { useFormState } from '~/hooks';
import { Tags } from './tags';

const initialFormState = useFormState.getState();

beforeEach(() => {
  // No form state: the labels come from props.
  useFormState.setState(initialFormState, true);
});

afterEach(() => {
  useFormState.setState(initialFormState, true);
});

describe('Tags', () => {
  it('shows the query type and an IPv6 target from props', () => {
    renderWithProviders(
      <Tags queryLocation={['router_one']} queryType="BGP Route" queryTarget={['2001:db8::/32']} />,
    );

    expect(screen.getByText(testConfig.web.text.queryType)).toBeInTheDocument();
    expect(screen.getByText('BGP Route')).toBeInTheDocument();
    expect(screen.getByText(testConfig.web.text.queryTarget)).toBeInTheDocument();
    expect(screen.getByText('2001:db8::/32')).toBeInTheDocument();
  });

  it('joins several targets', () => {
    renderWithProviders(
      <Tags
        queryLocation={['router_one']}
        queryType="Ping"
        queryTarget={['192.0.2.1', '2001:db8::1']}
      />,
    );

    expect(screen.getByText('192.0.2.1, 2001:db8::1')).toBeInTheDocument();
  });

  it('shows nothing without a location', () => {
    renderWithProviders(
      <Tags queryLocation={[]} queryType="BGP Route" queryTarget={['2001:db8::/32']} />,
    );

    expect(screen.queryByText('BGP Route')).not.toBeInTheDocument();
    expect(screen.queryByText('2001:db8::/32')).not.toBeInTheDocument();
  });
});
