import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConfig } from '~/context';
import { makeConfig, renderWithProviders, testConfig } from './render';

const SiteTitle = (): JSX.Element => {
  const { siteTitle, web } = useConfig();
  return (
    <p>
      {siteTitle} {web.text.queryTarget}
    </p>
  );
};

describe('test helpers', () => {
  it('loads the generated configuration', () => {
    expect(testConfig.siteTitle).toBe('hyperglass');
    const groups = testConfig.devices.map(group => group.group);
    expect(groups).toEqual(expect.arrayContaining(['North America', 'Europe']));
    const directives = testConfig.devices.flatMap(group =>
      group.locations.flatMap(location => location.directives.map(directive => directive.id)),
    );
    expect(directives).toContain('peer_communities');
  });

  it('provides the configuration to components', () => {
    renderWithProviders(<SiteTitle />);
    expect(screen.getByText(`hyperglass ${testConfig.web.text.queryTarget}`)).toBeInTheDocument();
  });

  it('merges overrides without changing the shared configuration', () => {
    const config = makeConfig({ web: { text: { queryTarget: 'Go' } } });
    renderWithProviders(<SiteTitle />, { config });
    expect(screen.getByText('hyperglass Go')).toBeInTheDocument();
    expect(config.web.text.title).toBe(testConfig.web.text.title);
    expect(testConfig.web.text.queryTarget).not.toBe('Go');
  });
});
