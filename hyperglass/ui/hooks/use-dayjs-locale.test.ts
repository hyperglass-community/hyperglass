import { renderHook, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import { describe, expect, it, vi } from 'vitest';
import { dayjsLocaleCandidates, loadDayjsLocale, useDayjsLocale } from './use-dayjs-locale';

describe('dayjsLocaleCandidates', () => {
  it.each([
    ['en', ['en']],
    ['pt-BR', ['pt-br', 'pt']],
    ['zh-Hant-TW', ['zh-hant-tw', 'zh-hant', 'zh']],
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

  it('falls back to English for a language dayjs has no locale for (#605)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await loadDayjsLocale('qq')).toBe('en');
    expect(warn).toHaveBeenCalledOnce();
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
