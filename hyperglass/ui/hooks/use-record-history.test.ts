import { describe, expect, it } from 'vitest';
import { makeConfig } from '~/__tests__/render';
import { directiveRetains } from './use-record-history';

import type { Device, Directive } from '~/types';

// Which locations' results a query may keep in the history (#558).

const config = makeConfig();
const devices = config.devices.flatMap(group => group.locations);

/** A fixture device, with `retain: false` on the directives named in `unretained`. */
function device(id: string, unretained: string[] = []): Device {
  const found = devices.find(d => d.id === id) as Device;
  return {
    ...found,
    directives: found.directives.map(
      (d): Directive => (unretained.includes(d.id) ? { ...d, retain: false } : d),
    ),
  };
}

const juniperRoute = '__hyperglass_juniper_bgp_route__';
const aristaRoute = '__hyperglass_arista_eos_bgp_route__';
const bgpRoute = { queryType: juniperRoute, queryTypeName: 'BGP Route' };

describe('directiveRetains', () => {
  it('is true for a directive that retains its results, the default', () => {
    expect(device('router_one').directives.every(d => d.retain)).toBe(true);
    expect(directiveRetains(device('router_one'), bgpRoute)).toBe(true);
  });

  it('is false for a directive with retain: false', () => {
    expect(directiveRetains(device('router_one', [juniperRoute]), bgpRoute)).toBe(false);
  });

  it("reads another location's own directive of the same name, as the backend runs it", () => {
    expect(directiveRetains(device('router_two', [aristaRoute]), bgpRoute)).toBe(false);
    expect(directiveRetains(device('router_two', [juniperRoute]), bgpRoute)).toBe(true);
  });

  it('prefers the directive with the query type ID over others of the same name', () => {
    const one = device('router_one');
    const sameName: Directive = { ...one.directives[0], id: 'custom_route', retain: false };
    const withBoth = { ...one, directives: [...one.directives, sameName] };

    expect(directiveRetains(withBoth, bgpRoute)).toBe(true);
  });

  it('is false when any directive of that name does not retain, without one of that ID', () => {
    const two = device('router_two');
    const sameName: Directive = { ...two.directives[0], id: 'custom_route', retain: false };
    const withBoth = { ...two, directives: [...two.directives, sameName] };

    expect(directiveRetains(withBoth, bgpRoute)).toBe(false);
  });

  it('is null for a query type the location does not have', () => {
    const query = { queryType: 'gone', queryTypeName: 'Gone' };
    expect(directiveRetains(device('router_one'), query)).toBeNull();
  });
});
