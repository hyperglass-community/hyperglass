import { renderHook, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTimePlugin from 'dayjs/plugin/relativeTime';
import { describe, expect, it, vi } from 'vitest';
import { dayjsLocaleCandidates, loadDayjsLocale, useDayjsLocale } from './use-dayjs-locale';

dayjs.extend(relativeTimePlugin);

describe('dayjsLocaleCandidates', () => {
  it.each([
    ['en', ['en']],
    ['pt-BR', ['pt-br', 'pt']],
    ['zh-Hant-TW', ['zh-hant-tw', 'zh-hant', 'zh-tw', 'zh']],
    ['sr-Cyrl', ['sr-cyrl', 'sr']],
    ['fr_CA', ['fr-ca', 'fr']],
  ])('maps %s to dayjs names, most specific first', (locale, names) => {
    expect(dayjsLocaleCandidates(locale)).toEqual(names);
  });
});

describe('loadDayjsLocale', () => {
  it('loads the most specific locale dayjs has (#605)', async () => {
    expect(await loadDayjsLocale('pt-BR')).toBe('pt-br');
    expect(await loadDayjsLocale('es-MX')).toBe('es');
    expect(dayjs().locale('pt-br').locale()).toBe('pt-br');
  });

  it('loads the region of a tag with a script dayjs has no locale for (#605)', async () => {
    expect(await loadDayjsLocale('zh-Hant-TW')).toBe('zh-tw');
    const now = dayjs();
    // Traditional Chinese, from zh-tw; zh-cn and zh write 小时.
    expect(now.locale('zh-tw').to(now.subtract(2, 'hour'), true)).toBe('2 小時');
  });

  it('uses English for a language dayjs has no locale for, and warns once (#605)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await loadDayjsLocale('qq')).toBe('en');
    expect(await loadDayjsLocale('qq')).toBe('en');

    // The missing file is remembered, so the second call neither looks nor warns.
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('tries a locale again after its chunk failed to download (#605)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chunkError = Object.assign(new Error('Loading chunk 123 failed.'), {
      name: 'ChunkLoadError',
    });
    const failing = vi.fn().mockRejectedValue(chunkError);

    expect(await loadDayjsLocale('fi-FI', failing)).toBe('en');
    // The failure stops the lookup, so `fi` isn't remembered in place of `fi-fi`.
    expect(failing).toHaveBeenCalledOnce();
    expect(failing).toHaveBeenCalledWith('fi-fi');

    // The failure wasn't remembered: the next load finds the locale.
    expect(await loadDayjsLocale('fi-FI')).toBe('fi');
    warn.mockRestore();
  });
});

describe('useDayjsLocale', () => {
  it('is English until the locale has loaded, then the locale (#605)', async () => {
    const { result } = renderHook(() => useDayjsLocale('nl'));

    expect(result.current).toBe('en');
    await waitFor(() => expect(result.current).toBe('nl'));
  });

  it('uses a locale already loaded from the first render (#605)', async () => {
    await loadDayjsLocale('sv');
    const { result } = renderHook(() => useDayjsLocale('sv'));

    expect(result.current).toBe('sv');
  });
});
