/**
 * The honesty frame: the part of the page that is true before anything loads.
 *
 * This markup is rendered **at build time** into `index.html` from the one
 * canonical constant in `scope.ts`, not assembled in the browser. That is a
 * deliberate ordering, and it is the reason this module exists separately from
 * the views:
 *
 * - **It does not depend on JavaScript running.** If the script fails, the
 *   network is down, or the GitHub API is unreachable, the page still carries
 *   its scope statement. A disclaimer that renders only on the happy path is a
 *   disclaimer that is missing exactly when the page is most confusing.
 * - **It is not in a footer.** ADR-0020 chose in-frame and non-dismissible for
 *   the walkthrough because a screenshot crops a footer, and a screenshot of a
 *   payments cockpit is the single most damaging artifact this project could
 *   produce. The same reasoning binds harder here: the trace shows a recording,
 *   the cockpit looks like the system.
 * - **It has no dismiss control.** There is no close button, no stored flag
 *   remembering that you have read it, and no collapse state — which is also
 *   why this repository uses no browser storage at all. The names of those
 *   storage APIs do not appear anywhere in the built output, and the build
 *   guard is what keeps that true.
 *
 * The views render into `<main id="view">`. Nothing outside that element is
 * ever rewritten, and `main.ts` re-checks this frame's scope statement before
 * every render — so a bug that damaged the frame would blank the application
 * rather than quietly publish a page without it.
 */

import { COCKPIT_ROLE, SCOPE_SOURCE, SCOPE_STATEMENT } from "./scope.js";

/** The attribute marking the element whose text must equal {@link SCOPE_STATEMENT}. */
export const SCOPE_MARKER = "data-scope-statement";

/** The attribute marking the provenance region — tag, commit and coverage. */
export const PROVENANCE_MARKER = "data-provenance";

/**
 * The attribute marking the acting-actor region.
 *
 * Emitted at build time like everything else in the frame, and rewritten by
 * `main.ts` on every render — the same arrangement the provenance region uses,
 * and for a stronger reason. The cockpit's most quotable screen is a payment
 * being refused to the person who raised it, and that screenshot is only honest
 * if it carries **who was asking**. A "you are acting as…" line inside the
 * scrolling view would be cropped out of exactly the image that most needs it;
 * in the frame it travels with every one.
 *
 * `main.ts` re-checks that this region is still present before and after every
 * render, alongside the scope statement, and blanks the application if it has
 * gone. A cockpit that lost track of whose credentials it was sending would be
 * showing refusals and approvals with no way to tell which was which.
 */
export const ACTING_MARKER = "data-acting-actor";

/** What the acting-actor region says before any instance is connected. */
export const NO_ACTOR_IN_CONTEXT = "No instance connected.";

/** The id of the one element the application is allowed to rewrite. */
export const VIEW_ROOT_ID = "view";

/** What the provenance region says when nothing is selected. */
export const NO_RELEASE_IN_CONTEXT = "No release in context.";

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for HTML. Used on every value that reaches generated markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * The frame, as HTML.
 *
 * The scope statement is emitted on a single line with no nested elements and
 * no surrounding whitespace, so that the element's text content is the
 * constant exactly — which is what `scope-verbatim` compares, byte for byte.
 */
export function honestyFrameHtml(): string {
  return [
    '<header class="frame" role="banner">',
    '  <div class="frame__masthead">',
    '    <span class="frame__wordmark">CloFin</span>',
    '    <span class="frame__product">operator cockpit</span>',
    '    <span class="frame__badge">owns no truth</span>',
    "  </div>",
    '  <div class="frame__scope">',
    `    <p class="frame__statement" ${SCOPE_MARKER}>${escapeHtml(SCOPE_STATEMENT)}</p>`,
    '    <p class="frame__attribution">Quoted verbatim from ' +
      `<a href="${escapeHtml(SCOPE_SOURCE.href)}" rel="noopener noreferrer">` +
      `${escapeHtml(SCOPE_SOURCE.label)}</a>.</p>`,
    "  </div>",
    `  <p class="frame__role">${escapeHtml(COCKPIT_ROLE)}</p>`,
    `  <div class="frame__provenance" ${PROVENANCE_MARKER}>`,
    `    <p class="provenance__empty">${escapeHtml(NO_RELEASE_IN_CONTEXT)}</p>`,
    "  </div>",
    `  <div class="frame__acting" ${ACTING_MARKER}>`,
    `    <span class="acting__label">Acting as</span>`,
    `    <span class="acting__value">${escapeHtml(NO_ACTOR_IN_CONTEXT)}</span>`,
    "  </div>",
    "</header>",
  ].join("\n");
}
