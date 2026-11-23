export function all<I extends unknown>(...iter: I[]): boolean {
  for (const i of iter) {
    if (!i) {
      return false;
    }
  }
  return true;
}

export function chunkArray<A extends unknown>(array: A[], size: number): A[][] {
  const result = [] as A[][];
  for (let i = 0; i < array.length; i += size) {
    const chunk = array.slice(i, i + size);
    result.push(chunk);
  }
  return result;
}

/**
 * Strictly typed version of `Object.entries()`.
 */
export function entries<O, K extends keyof O = keyof O>(obj: O): [K, O[K]][] {
  const _entries = [] as [K, O[K]][];
  const keys = Object.keys(obj as Record<string, unknown>) as K[];
  for (const key of keys) {
    _entries.push([key, obj[key]]);
  }
  return _entries;
}

/**
 * `fetch` that aborts the request if it has not answered within `timeout` milliseconds.
 *
 * Each call uses its own `AbortController`, and the timer is cleared once `fetch` settles, so
 * a timeout never reaches a later request. If `options.signal` is given, aborting it also
 * aborts the request; the timeout does not abort the caller's signal.
 */
export async function fetchWithTimeout(
  uri: string,
  // biome-ignore lint/style/useDefaultParameterLast: goal is to match the fetch API as closely as possible.
  options: RequestInit = {},
  timeout: number,
): Promise<Response> {
  const { signal: callerSignal, ...init } = options;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (callerSignal?.aborted) {
    abort();
  } else {
    callerSignal?.addEventListener('abort', abort, { once: true });
  }
  const timer = setTimeout(abort, timeout);
  try {
    return await fetch(uri, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abort);
  }
}

export function dedupObjectArray<E extends Record<string, unknown>, P extends keyof E = keyof E>(
  arr: E[],
  property: P,
): E[] {
  return arr.reduce((acc: E[], current: E) => {
    const x = acc.find(item => {
      const itemValue = item[property];
      const currentValue = current[property];
      const validType = all(typeof itemValue !== 'undefined', typeof currentValue !== 'undefined');
      return validType && itemValue === currentValue;
    });

    if (!x) {
      return acc.concat([current]);
    }
    return acc;
  }, []);
}

interface AndJoinOptions {
  /**
   * Separator for last item.
   *
   * @default '&'
   */
  separator?: string;

  /**
   * Use the oxford comma.
   *
   * @default true
   */
  oxfordComma?: boolean;

  /**
   * Wrap each item in a character.
   *
   * @default ''
   */
  wrap?: string;
}

/**
 * Create a natural list of values from an array of strings
 * @param values
 * @param options
 * @returns
 */
export function andJoin(values: string[], options?: AndJoinOptions): string {
  let mergedOptions = { separator: '&', oxfordComma: true, wrap: '' } as Required<AndJoinOptions>;
  if (typeof options === 'object' && options !== null) {
    mergedOptions = { ...mergedOptions, ...options };
  }
  const { separator, oxfordComma, wrap } = mergedOptions;
  const parts = values.filter(v => typeof v === 'string');
  const lastElement = parts.pop();
  if (typeof lastElement === 'undefined') {
    return '';
  }
  const last = [wrap, lastElement, wrap].join('');
  if (parts.length > 0) {
    const main = parts.map(p => [wrap, p, wrap].join('')).join(', ');
    const comma = oxfordComma && parts.length >= 2 ? ',' : '';
    const result = `${main}${comma} ${separator} ${last}`;
    return result.trim();
  }
  return last;
}

/**
 * Determine if an input value is an FQDN string.
 *
 * @param value Input value.
 */
export function isFQDN(value: string | string[]): value is string {
  /**
   * Don't set the global flag on this.
   * @see https://stackoverflow.com/questions/24084926/javascript-regexp-cant-use-twice
   *
   * TLDR: the test() will pass the first time, but not the second. In React Strict Mode & in a dev
   * environment, this will mean isFqdn will be true the first time, then false the second time,
   * submitting the FQDN to hyperglass the second time.
   */
  const pattern = new RegExp(
    /^(?!:\/\/)([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-][a-zA-Z0-9-]+\.[a-zA-Z-]{2,6}?$/im,
  );
  if (Array.isArray(value)) {
    return isFQDN(value[0]);
  }
  return typeof value === 'string' && pattern.test(value);
}

/**
 * A random 128-bit ID as 32 hexadecimal characters. `crypto.randomUUID` is only
 * available on HTTPS pages, and a looking glass may be served over plain HTTP;
 * `crypto.getRandomValues` is available on both.
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
