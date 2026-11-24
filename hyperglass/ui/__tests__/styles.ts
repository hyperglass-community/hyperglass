/**
 * Read the CSS rules Emotion generated for an element. jsdom doesn't apply `:hover`,
 * `:focus` or `:focus-visible` the way a browser does, so a test of a state's styling
 * checks the rules instead.
 */

/** One CSS rule: one selector of its selector list, and its declarations. */
export interface StyleRule {
  selector: string;
  css: string;
}

/**
 * The rules, in document order, whose selector is exactly one of the element's classes
 * followed by one of `suffixes`: `''` for the class alone, `':focus-visible'` for its
 * keyboard focus rule. A selector list counts once per matching selector in it.
 */
export function classRules(element: Element, suffixes: string[] = ['']): StyleRule[] {
  const wanted = new Set(
    Array.from(element.classList).flatMap(c => suffixes.map(suffix => `.${c}${suffix}`)),
  );
  const rules: StyleRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule)) {
        continue;
      }
      for (const selector of rule.selectorText.split(',').map(s => s.trim())) {
        if (wanted.has(selector)) {
          rules.push({ selector, css: rule.style.cssText });
        }
      }
    }
  }
  return rules;
}

/**
 * The value of `property` from the last of `rules` that sets it. Emotion gives an
 * element's rules the same specificity, so the last one wins. `null` when none sets it.
 */
export function lastValue(rules: StyleRule[], property: string): string | null {
  let value: string | null = null;
  const pattern = new RegExp(`(?:^|;\\s*)${property}:\\s*([^;]+)`);
  for (const rule of rules) {
    const match = pattern.exec(rule.css);
    if (match !== null) {
      value = match[1].trim();
    }
  }
  return value;
}
