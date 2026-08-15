/**
 * The scope statement, and the one place it is written down.
 *
 * This string is the `disclaimer` field of `clofin-core`'s `GET /` response,
 * copied character for character. It is the first thing this repository built
 * and the thing every other part of it is arranged around: a cockpit that
 * shows a payments system doing real things is exactly the artifact most
 * likely to be screenshotted and circulated without its context, and this
 * sentence is the context.
 *
 * **There is one copy.** Not one per view, not one in the HTML and one in the
 * code — one constant, rendered into the page at build time and asserted
 * again at runtime before every view. A second copy is a copy that can be
 * softened while the first stays honest, which is the failure standing lesson
 * **L-6** records: a guard over the copy the author was looking at is the
 * defect it exists to catch. The `scope-verbatim` check therefore compares
 * this constant against the built page *and* against the README's quotation,
 * and treats any near-copy anywhere as a full copy that must match.
 *
 * Softening this wording is not a style change. If `clofin-core`'s `GET /`
 * response ever changes, this constant changes with it in the same commit,
 * and the check is what makes that non-optional.
 *
 * Source: `clofin-core` `src/clofin/api/health.clj`, the `info` handler.
 * @see https://github.com/EchoJustus/clofin-core/blob/main/src/clofin/api/health.clj
 */
export const SCOPE_STATEMENT: string =
  "CloFin operates on synthetic data only. It is not connected to any bank, " +
  "payment scheme or central bank, holds no regulatory authorisation, and " +
  "never processes real funds.";

/**
 * What this repository is, in its own words rather than `clofin-core`'s.
 *
 * Kept separate from {@link SCOPE_STATEMENT} because the two have different
 * standing: the statement above is quoted and may not be edited here, while
 * this sentence is the cockpit's own and describes only the cockpit. It makes
 * no claim about what any CloFin control guarantees — that is RULE 3's
 * territory, and RULE 3 says such sentences are quotations.
 */
export const COCKPIT_ROLE: string =
  "This cockpit owns no truth. It is a client: it reads the CloFin project's " +
  "published releases and generates commands you run yourself. It computes " +
  "nothing about payments, and it stores nothing.";

/** Where the quoted statement comes from, shown beside it so it can be checked. */
export const SCOPE_SOURCE = {
  label: "clofin-core GET / — the disclaimer field",
  href: "https://github.com/EchoJustus/clofin-core/blob/main/src/clofin/api/health.clj",
} as const;
