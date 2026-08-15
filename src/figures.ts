/**
 * The only path by which a figure reaches the screen.
 *
 * The cockpit's central claim is that it **performs no outcome and computes no
 * figure**. Every balance, total, count and status an operator reads here is a
 * value some instance put in a response body. That is easy to say and easy to
 * break: one `reduce` that adds two line amounts, one helper that divides minor
 * units by a hundred to make a nicer label, and the page is quietly asserting a
 * number nobody sent it — on a screen whose whole purpose is to be believed.
 *
 * So the rule is made structural rather than remembered.
 *
 * ## What a figure is
 *
 * A {@link Figure} is produced by exactly one function, {@link readFigure},
 * which takes a **response body** and a path, and returns the value found at
 * that path. There is no other constructor, no arithmetic in this module — the
 * word "no arithmetic" is checkable here because the file is short enough to
 * read in a minute — and nothing that formats, scales, rounds or localises.
 *
 * `{"currency":"SGD","minorUnits":375000}` renders as
 * `{"currency":"SGD","minorUnits":375000}`. It is not turned into "SGD
 * 3,750.00", because that conversion is arithmetic performed by this
 * repository, and a reader could not tell a correct conversion from a wrong
 * one without doing it again themselves. The instance said 375000 minor units;
 * the screen says 375000 minor units.
 *
 * ## Re-serialised, not re-derived
 *
 * The text a figure carries is `JSON.stringify` of the sub-value parsed out of
 * the body. That is a projection of the response, not a computation on it: no
 * operand is combined with another, and integers round-trip exactly. The raw
 * body it was read from is rendered on the same screen, beside it, never behind
 * a link — so the projection can be checked against its source by looking, in
 * the same way `raw-view.ts` shows an indented body beside the original rather
 * than instead of it.
 *
 * ## What is enforced, and where
 *
 * - `figures.test.ts` asserts that a projected figure appears **verbatim** in
 *   the body it was read from, for every figure shape the flows render, and
 *   that a missing path reports itself as missing rather than as zero.
 * - `tools/guard-network.mjs` refuses to publish a site in which any of the
 *   standard number-formatting calls appears anywhere, or in which a
 *   money-carrying member stands next to an arithmetic operator in any module.
 *   A cockpit that computed a balance would not be built.
 *
 * Their names are deliberately not written out here. The guard reads this file
 * like any other — comments included — so naming the four calls in a comment
 * about refusing them would fail the build, which is the rule working bluntly
 * on purpose rather than an inconvenience. ADR-0002 describes the three browser
 * stores the same way and for the same reason, and 011-REQ N-5 records the
 * first time this repository learned it. The authoritative list lives in
 * `tools/guard-network.mjs`, which is not part of the built site.
 *
 * The blunt rule is deliberate, in the shape ADR-0002 chose for the UUID rule:
 * there is no legitimate reason for this repository to format a number, so
 * "never" has no exceptions to argue about.
 */

/** A value read out of a response, and the path it was read from. */
export interface Figure {
  /** The dotted path read, e.g. `closingBalance` or `account.code`. */
  readonly path: string;
  /**
   * The value, re-serialised from the parsed body without change.
   *
   * `null` when the path was not present. A figure that could not be found
   * reports that it could not be found; it never stands in for a zero, because
   * "the instance did not say" and "the instance said none" are different
   * facts and collapsing them is how a screen invents a balance.
   */
  readonly text: string | null;
}

/** Whether a figure was found at all. Kept as a function so callers read clearly. */
export function found(figure: Figure): boolean {
  return figure.text !== null;
}

/** What to show where a figure is absent. Never a number. */
export const ABSENT = "not in the response";

/** The figure's text, or the words for its absence. Selection only. */
export function figureText(figure: Figure): string {
  return figure.text ?? ABSENT;
}

/**
 * Walk a dotted path into a parsed body.
 *
 * Exported because the runner needs the same walk to pull an id out of a
 * response for a later step, and two walkers would eventually disagree about
 * what `a.0.b` means. It returns the parsed value, not a figure: an id going
 * into the next request is not a figure reaching the screen, and only the
 * latter is what this module's rule is about.
 */
export function valueAt(body: string | null, path: string): unknown {
  if (body === null) return undefined;
  try {
    return walk(JSON.parse(body) as unknown, path.split("."));
  } catch {
    return undefined;
  }
}

function walk(value: unknown, segments: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) return undefined;
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Read one value out of a response body.
 *
 * The body is the text the instance sent. Nothing else is consulted — there is
 * no default, no fallback to an earlier response, and no value this repository
 * could supply if the instance did not.
 */
export function readFigure(body: string | null, path: string): Figure {
  const value = valueAt(body, path);
  if (value === undefined) return { path, text: null };
  return { path, text: JSON.stringify(value) };
}
