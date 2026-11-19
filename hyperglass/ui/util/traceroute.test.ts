import { describe, expect, it } from 'vitest';
import {
  formatHopASN,
  formatHopHostname,
  formatHopIP,
  formatHopRTT,
  isBlankHopValue,
} from './traceroute';

describe('isBlankHopValue', () => {
  it.each([null, undefined, '', '   ', 'None', 'null'])('treats %j as blank', value => {
    expect(isBlankHopValue(value)).toBe(true);
  });

  it.each(['13335', 'IXP', '192.0.2.1'])('treats %j as present', value => {
    expect(isBlankHopValue(value)).toBe(false);
  });
});

describe('formatHopASN', () => {
  it('shows a numeric ASN without an AS prefix', () => {
    expect(formatHopASN('13335')).toBe('13335');
  });

  it('shows an exchange-point hop as IXP', () => {
    expect(formatHopASN('IXP')).toBe('IXP');
  });

  it.each([null, undefined, '', 'None', 'null'])('returns null for %j', value => {
    expect(formatHopASN(value)).toBeNull();
  });
});

describe('formatHopIP', () => {
  it('prefers display_ip for truncated IPv6', () => {
    expect(formatHopIP({ display_ip: '2001:db8::1…', ip_address: '2001:db8::1:2:3:4' })).toBe(
      '2001:db8::1…',
    );
  });

  it('falls back to ip_address', () => {
    expect(formatHopIP({ display_ip: null, ip_address: '192.0.2.1' })).toBe('192.0.2.1');
    expect(formatHopIP({ display_ip: 'None', ip_address: '2001:db8::1' })).toBe('2001:db8::1');
  });

  it('returns null when neither address is set', () => {
    expect(formatHopIP({ display_ip: null, ip_address: null })).toBeNull();
    expect(formatHopIP({ display_ip: '', ip_address: 'None' })).toBeNull();
  });
});

describe('formatHopHostname', () => {
  it('returns the hostname', () => {
    expect(formatHopHostname('router.example.net')).toBe('router.example.net');
  });

  it.each([null, '', 'None', 'null'])('returns null for %j', value => {
    expect(formatHopHostname(value)).toBeNull();
  });
});

describe('formatHopRTT', () => {
  it('formats to one decimal place in milliseconds', () => {
    expect(formatHopRTT(1.234)).toBe('1.2ms');
    expect(formatHopRTT(0)).toBe('0.0ms');
  });

  it.each([null, undefined])('returns null for %j', value => {
    expect(formatHopRTT(value)).toBeNull();
  });
});
