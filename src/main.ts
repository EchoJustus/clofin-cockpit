/**
 * The application entry point and its router.
 *
 * Two responsibilities, in this order of importance.
 *
 * **1. Keep the honesty frame true.** Before every render, and again after it,
 * {@link assertFrameIntact} checks that the page still carries the scope
 * statement, that it still matches the canonical constant character for
 * character, and that the provenance region is still there. If any of that has
 * stopped being true the application does not carry on with a degraded page —
 * it replaces the document with a failure notice and stops. A cockpit that
 * kept rendering releases after losing its disclaimer would be the exact
 * artifact ADR-0020 spent a page refusing to build, so the failure mode is
 * "shows nothing", never "shows the interesting part".
 *
 * That check cannot pass by accident: the frame is emitted at build time and
 * the only element this file ever rewrites is `<main id="view">`.
 *
 * **2. Route.** Two views, addressed by hash so that GitHub Pages needs no
 * server-side rewrite and a deep link into a release survives a reload:
 *
 *     #/releases            the list
 *     #/releases/ref-1      one release and its deployment card
 */

import { replaceChildren, require$ } from "./dom.js";
import { PROVENANCE_MARKER, SCOPE_MARKER, VIEW_ROOT_ID } from "./frame.js";
import { fetchReleaseRecords, type ReleaseRecord } from "./releases.js";
import { SCOPE_STATEMENT } from "./scope.js";
import {
  errorView,
  loadingView,
  notFoundView,
  releaseDetailView,
  releaseListView,
  renderProvenance,
} from "./views.js";

/** Thrown when the page can no longer be trusted to be showing its own scope. */
class FrameDamaged extends Error {}

function halt(reason: string): never {
  // Deliberately built with textContent only: at this point the page's own
  // markup is suspect, so nothing is interpolated into it.
  const notice = document.createElement("p");
  notice.textContent =
    "This page has stopped, because it could no longer show the statement it is " +
    `required to show alongside anything else. (${reason})`;
  const wrapper = document.createElement("main");
  wrapper.className = "halted";
  wrapper.append(notice);
  document.body.replaceChildren(wrapper);
  throw new FrameDamaged(reason);
}

/** Verify the frame before trusting the page to display anything else. */
function assertFrameIntact(): void {
  const statement = document.querySelector(`[${SCOPE_MARKER}]`);
  if (!statement) halt("the scope statement is missing from the page");
  if (statement.textContent !== SCOPE_STATEMENT) {
    halt("the scope statement on the page is not the canonical one");
  }
  if (!document.querySelector(`[${PROVENANCE_MARKER}]`)) {
    halt("the provenance region is missing from the page");
  }
}

interface Route {
  readonly name: "list" | "detail";
  readonly tag: string | null;
}

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const detail = /^releases\/(.+)$/.exec(hash);
  if (detail?.[1]) return { name: "detail", tag: decodeURIComponent(detail[1]) };
  return { name: "list", tag: null };
}

/** In-memory only, for the life of the page. Nothing is persisted anywhere. */
let records: readonly ReleaseRecord[] | null = null;
let failure: unknown = null;

function render(): void {
  assertFrameIntact();

  const view = require$<HTMLElement>(`#${VIEW_ROOT_ID}`);
  const provenance = require$(`[${PROVENANCE_MARKER}]`);
  const route = currentRoute();

  if (failure !== null) {
    renderProvenance(provenance, null);
    replaceChildren(view, errorView(failure));
  } else if (records === null) {
    renderProvenance(provenance, null);
    replaceChildren(view, loadingView());
  } else if (route.name === "detail") {
    const record = records.find((candidate) => candidate.release.tag === route.tag) ?? null;
    renderProvenance(provenance, record);
    replaceChildren(view, record ? releaseDetailView(record) : notFoundView(route.tag ?? ""));
  } else {
    renderProvenance(provenance, null);
    replaceChildren(view, releaseListView(records));
  }

  // Again afterwards: the render above must not have been able to touch the
  // frame, and this is what makes "must not" checkable rather than intended.
  assertFrameIntact();
  window.scrollTo(0, 0);
}

async function start(): Promise<void> {
  render();

  try {
    records = await fetchReleaseRecords();
  } catch (error) {
    failure = error;
  }

  render();
}

window.addEventListener("hashchange", render);
void start();
