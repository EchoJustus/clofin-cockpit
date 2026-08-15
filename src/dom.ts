/**
 * A very small DOM builder, and the reason it exists.
 *
 * Everything this cockpit displays that came from outside — a release title, a
 * release body, an error message from GitHub — is set with `textContent`, never
 * with `innerHTML`. There is no template engine, no interpolation of untrusted
 * text into markup, and therefore no escaping to get wrong. The built page's
 * `Content-Security-Policy` blocks inline script regardless, but a page whose
 * safety rests only on a header is a page relying on one control.
 *
 * This is about thirty lines of helper rather than a rendering framework
 * because the alternative — taking a runtime dependency to render four views —
 * is the trade `docs/ADR/0001` declines.
 */

export type Child = Node | string | null | undefined | false;

export type Attributes = Readonly<Record<string, string | boolean | null | undefined>>;

/** Create an element, set its attributes, and append its children as text or nodes. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? "" : value);
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return element;
}

/** Replace everything inside `parent` with `children`. */
export function replaceChildren(parent: Element, ...children: readonly Child[]): void {
  parent.replaceChildren(
    ...children
      .filter((child): child is Node | string => child !== null && child !== undefined && child !== false)
      .map((child) => (typeof child === "string" ? document.createTextNode(child) : child)),
  );
}

/** Find one element, or throw — a missing anchor is a build defect, not a runtime state. */
export function require$<E extends Element>(selector: string): E {
  const found = document.querySelector<E>(selector);
  if (!found) throw new Error(`The page is missing ${selector}, which the build should have emitted.`);
  return found;
}
