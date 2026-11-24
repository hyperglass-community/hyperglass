import { useEffect, useState } from 'react';

/** dayjs has English built in; every other locale is a file loaded on demand. */
const BUILT_IN = 'en';

/**
 * Locales resolved, by configured tag, as the dayjs locale name to use: the locale that
 * loaded, or English when dayjs has none for the tag. A load that failed for another
 * reason (a chunk that didn't download, say) isn't kept, so it is tried again the next
 * time an age is shown.
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

/** Import a dayjs locale file, which registers the locale with dayjs. */
export type LocaleImporter = (name: string) => Promise<unknown>;

const importFromBundle: LocaleImporter = name =>
  // The bundler splits every file under `dayjs/locale` into its own chunk, loaded only
  // when used.
  import(`dayjs/locale/${name}.js`);

/**
 * Whether `error` says there is no such locale file, which won't change on a retry:
 * webpack's context module throws `MODULE_NOT_FOUND` for a name it doesn't have, and
 * Node (under Vitest) `ERR_MODULE_NOT_FOUND`. Anything else, such as webpack's
 * `ChunkLoadError` or a network error, may succeed later.
 */
function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}

/**
 * Load the dayjs locale for `locale` and resolve with its dayjs name: the most specific
 * one dayjs has, or English when it has none, which is remembered and warned about once.
 * When a load fails for another reason, resolve with English without remembering it,
 * and without trying less specific locales, so a later call tries the right one again.
 */
export function loadDayjsLocale(
  locale: string,
  importer: LocaleImporter = importFromBundle,
): Promise<string> {
  const known = loaded.get(locale);
  if (known !== undefined) {
    return Promise.resolve(known);
  }
  let pending = loading.get(locale);
  if (pending === undefined) {
    pending = (async () => {
      for (const name of dayjsLocaleCandidates(locale)) {
        if (name === BUILT_IN) {
          loaded.set(locale, name);
          return name;
        }
        try {
          await importer(name);
          loaded.set(locale, name);
          return name;
        } catch (error) {
          if (!isMissing(error)) {
            console.warn(`Could not load the dayjs locale '${name}'; using English.`, error);
            return BUILT_IN;
          }
        }
      }
      console.warn(`No dayjs locale matches web.locale '${locale}'; using English.`);
      loaded.set(locale, BUILT_IN);
      return BUILT_IN;
    })();
    loading.set(locale, pending);
    // Errors are caught above, so this never rejects.
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
