import { useEffect, useState } from 'react';

/** dayjs has English built in; every other locale is a file loaded on demand. */
const BUILT_IN = 'en';

/**
 * Locales already loaded, by configured tag, as the dayjs locale name to use. Only a
 * load that found a locale is kept, so one that failed (a chunk that didn't download,
 * say) is tried again the next time an age is shown.
 */
const loaded = new Map<string, string>([[BUILT_IN, BUILT_IN]]);

/** Loads in progress, by configured tag, so concurrent cells fetch a locale once. */
const loading = new Map<string, Promise<string>>();

/**
 * dayjs locale names to try for a BCP 47 tag, most specific first. dayjs names its
 * locales in lower case (`pt-br`, `zh-cn`), so `pt-BR` tries `pt-br`, then `pt`. dayjs
 * has no script locales, so a tag with a script also tries its language and region
 * without it: `zh-Hant-TW` tries `zh-hant-tw`, `zh-hant`, `zh-tw`, then `zh`.
 */
export function dayjsLocaleCandidates(locale: string): string[] {
  const parts = locale.toLowerCase().replace(/_/g, '-').split('-').filter(Boolean);
  const candidates = [] as string[];
  for (let i = parts.length; i > 1; i--) {
    candidates.push(parts.slice(0, i).join('-'));
  }
  const [language, script, region] = parts;
  if (region !== undefined && /^[a-z]{4}$/.test(script)) {
    candidates.push(`${language}-${region}`);
  }
  if (language !== undefined) {
    candidates.push(language);
  }
  return candidates;
}

async function importLocale(name: string): Promise<boolean> {
  if (name === BUILT_IN) {
    return true;
  }
  try {
    // Each locale file registers itself with dayjs when it is imported. The bundler
    // splits every file under `dayjs/locale` into its own chunk, loaded only when used.
    await import(`dayjs/locale/${name}.js`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the dayjs locale for `locale` and resolve with its dayjs name: the most specific
 * one dayjs has, or English when none loads. English isn't remembered, so a later call
 * tries again.
 */
export function loadDayjsLocale(locale: string): Promise<string> {
  const known = loaded.get(locale);
  if (known !== undefined) {
    return Promise.resolve(known);
  }
  let pending = loading.get(locale);
  if (pending === undefined) {
    pending = (async () => {
      for (const name of dayjsLocaleCandidates(locale)) {
        if (await importLocale(name)) {
          loaded.set(locale, name);
          return name;
        }
      }
      console.warn(`No dayjs locale matches web.locale '${locale}'; using English.`);
      return BUILT_IN;
    })();
    loading.set(locale, pending);
    // `importLocale` never rejects, so neither does this.
    pending.then(() => loading.delete(locale));
  }
  return pending;
}

/**
 * The dayjs locale name to format relative times in for `locale`. English until the
 * locale's file has loaded, then the loaded locale.
 */
export function useDayjsLocale(locale: string): string {
  const [name, setName] = useState(() => loaded.get(locale) ?? BUILT_IN);

  useEffect(() => {
    let current = true;
    const known = loaded.get(locale);
    if (known !== undefined) {
      setName(known);
      return;
    }
    loadDayjsLocale(locale).then(loadedName => {
      if (current) {
        setName(loadedName);
      }
    });
    return () => {
      current = false;
    };
  }, [locale]);

  return name;
}
