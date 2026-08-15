/**
 * Release-audit coverage, read out of a release body — and refusing to guess.
 *
 * `clofin-core` records what a release audit actually covered in a paragraph
 * of the GitHub release body that begins `RELEASE AUDIT:`; the same text is
 * mirrored in that repository's `docs/releases/<tag>.annotation.txt`. For
 * `ref-1` it reads:
 *
 * >  RELEASE AUDIT: PARTIAL. Charter items 1-4 of 8 were performed …
 *
 * This module turns that paragraph into a value, and its whole design is the
 * behaviour when it cannot.
 *
 * **It fails closed.** Every uncertain path returns {@link NOT_FOUND}, which
 * renders as *"coverage statement not found"*. There is deliberately no
 * default status, no empty string, and no fallback that reads as reassurance:
 * a cockpit that renders blank where the coverage should be is a cockpit that
 * shows an unaudited release as though it had nothing to declare, and a
 * cockpit that defaults toward *audited* is worse than one that shows nothing
 * at all. `clofin-core`'s standing lessons L-6 (a partial guard passes on
 * softened input) and L-13 (a precondition must fail closed rather than rely
 * on a convention) are both about this shape.
 *
 * Four things therefore make the parser refuse rather than improvise:
 *
 * 1. The marker must **open a paragraph**. `RELEASE AUDIT:` buried inside a
 *    sentence is prose about an audit, not a declaration of one.
 * 2. The status token must be in {@link COVERAGE_STATUSES}. An unrecognised
 *    word is not passed through and not interpreted — `ref-3: MOSTLY` is not
 *    a coverage level this project has defined, so it is not one.
 * 3. **Two such paragraphs are worse than none.** If a body declares coverage
 *    twice, this module cannot tell which governs, so it declares neither.
 * 4. A recognised status with no stated scope keeps the status and says the
 *    scope is missing. It never invents the scope, and never lets a bare
 *    status imply a full one.
 */

/** The coverage levels `clofin-core` defines. Nothing else is a coverage level. */
export const COVERAGE_STATUSES = ["FULL", "PARTIAL", "NONE"] as const;

export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

/** A coverage statement that was found and understood. */
export interface StatedCoverage {
  readonly kind: "stated";
  readonly status: CoverageStatus;
  /** e.g. `"charter items 1-4 of 8"`, or `null` when the body did not say. */
  readonly scope: string | null;
  /** The paragraph it was read from, so the page can show its own source. */
  readonly paragraph: string;
}

/** No coverage statement could be read. Carries why, for the reader and the log. */
export interface MissingCoverage {
  readonly kind: "not-found";
  readonly reason: string;
}

export type Coverage = StatedCoverage | MissingCoverage;

/**
 * The words the interface uses when there is nothing trustworthy to show.
 * Exported so the view, the tests and the checks all say the same thing.
 */
export const COVERAGE_NOT_FOUND_LABEL = "coverage statement not found";

const NOT_FOUND = (reason: string): MissingCoverage => ({ kind: "not-found", reason });

/** `RELEASE AUDIT:` — at the start of a paragraph, not in the middle of a sentence. */
const MARKER = /^[ \t]*RELEASE\s+AUDIT:[ \t]*/i;

/** The status word that follows the marker, up to its terminating punctuation. */
const STATUS_TOKEN = /^([A-Za-z]+)/;

/**
 * The documented scope form, `Charter items 1-4 of 8`, and the one sensible
 * variant for a release that covered everything. Both are matched against the
 * whitespace-flattened paragraph, because the release body is hard-wrapped and
 * a scope statement may straddle a line break.
 */
const SCOPE_PATTERNS: readonly RegExp[] = [
  /charter items?\s+(\d+)\s*[-‐-―]\s*(\d+)\s+of\s+(\d+)/i,
  /all\s+(\d+)\s+charter\s+items/i,
];

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isCoverageStatus(word: string): word is CoverageStatus {
  return (COVERAGE_STATUSES as readonly string[]).includes(word);
}

function readScope(flatParagraph: string): string | null {
  const [charterItems, allItems] = SCOPE_PATTERNS;

  const ranged = charterItems?.exec(flatParagraph);
  if (ranged) {
    return `charter items ${ranged[1]}-${ranged[2]} of ${ranged[3]}`;
  }

  const all = allItems?.exec(flatParagraph);
  if (all) {
    return `all ${all[1]} charter items`;
  }

  return null;
}

/**
 * Split a release body into paragraphs. GitHub returns release bodies with
 * CRLF line endings; a blank line — which may itself carry trailing spaces —
 * separates paragraphs.
 */
function paragraphsOf(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * Read the release-audit coverage out of a release body.
 *
 * Returns {@link StatedCoverage} only when the body says something this
 * project has defined. Every other input — empty, absent, malformed,
 * ambiguous, or using a word that is not a coverage level — returns
 * {@link MissingCoverage}.
 */
export function parseCoverage(body: string | null | undefined): Coverage {
  if (typeof body !== "string" || body.trim().length === 0) {
    return NOT_FOUND("the release has no body text");
  }

  const declarations = paragraphsOf(body).filter((paragraph) => MARKER.test(paragraph));

  if (declarations.length === 0) {
    return NOT_FOUND("no paragraph of the release body begins with “RELEASE AUDIT:”");
  }

  if (declarations.length > 1) {
    // Ambiguity is not a reason to pick one. See rule 3 in the module note.
    return NOT_FOUND(
      `${declarations.length} paragraphs of the release body begin with “RELEASE AUDIT:”, ` +
        "so which one states the coverage is undetermined",
    );
  }

  const paragraph = declarations[0] as string;
  const flat = flatten(paragraph);
  const afterMarker = flat.replace(MARKER, "");
  const token = STATUS_TOKEN.exec(afterMarker)?.[1];

  if (!token) {
    return NOT_FOUND("the “RELEASE AUDIT:” paragraph states no coverage level");
  }

  const status = token.toUpperCase();
  if (!isCoverageStatus(status)) {
    return NOT_FOUND(
      `“${token}” is not a coverage level this project defines ` +
        `(expected one of ${COVERAGE_STATUSES.join(", ")})`,
    );
  }

  return { kind: "stated", status, scope: readScope(flat), paragraph };
}

/**
 * The one-line label the interface shows.
 *
 * `PARTIAL — charter items 1-4 of 8` for `ref-1`; never a bare status that
 * could be read as a clean bill of health, and never an empty string.
 */
export function formatCoverage(coverage: Coverage): string {
  if (coverage.kind === "not-found") {
    return COVERAGE_NOT_FOUND_LABEL;
  }

  const scope = coverage.scope ?? "scope not stated in the release body";
  return `${coverage.status} — ${scope}`;
}
