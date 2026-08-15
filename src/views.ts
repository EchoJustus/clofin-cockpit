/**
 * The views. There are three, and none of them draws the honesty frame —
 * the frame is already in the page before any of this runs (`frame.ts`).
 *
 * Every sentence here that says what CloFin *does* is either about this
 * cockpit, or a quotation with a link. That is ADR-0020 RULE 3, and in this
 * repository it is checked rather than reviewed: `no-unqualified-audited`
 * fails the build on any text calling a release audited, verified or reviewed
 * without its coverage beside it.
 */

import { composeCard, composeScript, type ComposeCard } from "./compose.js";
import { CORE_REPO } from "./core-repo.js";
import { COVERAGE_NOT_FOUND_LABEL } from "./coverage.js";
import { el, replaceChildren } from "./dom.js";
import { NO_RELEASE_IN_CONTEXT } from "./frame.js";
import { provenanceFields } from "./provenance.js";
import type { ReleaseRecord } from "./releases.js";
import { shortSha } from "./releases.js";
import { BlockedOriginError, HttpError, RateLimited } from "./net.js";

/** Render the provenance triple into the frame's provenance region. */
export function renderProvenance(region: Element, record: ReleaseRecord | null): void {
  if (!record) {
    replaceChildren(region, el("p", { class: "provenance__empty" }, [NO_RELEASE_IN_CONTEXT]));
    return;
  }

  // The tuple is what guarantees all three appear. See provenance.ts.
  const fields = provenanceFields(record).map((field) =>
    el("div", { class: "provenance__field" }, [
      el("span", { class: "provenance__label" }, [field.label]),
      el("span", { class: field.mono ? "provenance__value provenance__value--mono" : "provenance__value" }, [
        field.value,
      ]),
      field.qualifier && el("span", { class: "provenance__qualifier" }, [field.qualifier]),
    ]),
  );

  replaceChildren(region, el("div", { class: "provenance" }, fields));
}

function coverageLine(record: ReleaseRecord): HTMLElement {
  const { coverage } = record;
  const missing = coverage.kind === "not-found";

  return el("div", { class: missing ? "coverage coverage--missing" : "coverage" }, [
    el("span", { class: "coverage__label" }, ["Release-audit coverage"]),
    el("span", { class: "coverage__value" }, [
      missing ? COVERAGE_NOT_FOUND_LABEL : `${coverage.status} — ${coverage.scope ?? "scope not stated in the release body"}`,
    ]),
    missing
      ? el("p", { class: "coverage__why" }, [`Read from the release body: ${coverage.reason}.`])
      : el("p", { class: "coverage__why" }, ["Read from the RELEASE AUDIT: paragraph of the release body, not typed here."]),
  ]);
}

/** The release list — the default view. */
export function releaseListView(records: readonly ReleaseRecord[]): HTMLElement {
  if (records.length === 0) {
    return el("section", { class: "panel" }, [
      el("h1", {}, ["Releases"]),
      el("p", {}, [
        `No ref-<n> releases were returned for ${CORE_REPO.owner}/${CORE_REPO.name}.`,
      ]),
    ]);
  }

  return el("section", { class: "panel" }, [
    el("h1", {}, ["Releases"]),
    el("p", { class: "panel__lede" }, [
      "Tagged snapshots of the CloFin reference implementation, read from the ",
      "GitHub Releases API. Each one shows its commit and what its release audit ",
      "actually covered, taken from the release body.",
    ]),
    el(
      "ul",
      { class: "releases" },
      records.map((record) =>
        el("li", { class: "release" }, [
          el("div", { class: "release__head" }, [
            el("a", { class: "release__tag", href: `#/releases/${record.release.tag}` }, [record.release.tag]),
            record.release.prerelease && el("span", { class: "chip chip--prerelease" }, ["pre-release"]),
            el("span", { class: "release__sha" }, [shortSha(record.sha)]),
          ]),
          el("p", { class: "release__name" }, [record.release.name]),
          coverageLine(record),
          el("a", { class: "release__more", href: `#/releases/${record.release.tag}` }, [
            "Open deployment card →",
          ]),
        ]),
      ),
    ),
  ]);
}

function commandBlock(title: string, note: string | null, commands: readonly string[]): HTMLElement {
  return el("div", { class: "commands" }, [
    el("h3", { class: "commands__title" }, [title]),
    note && el("p", { class: "commands__note" }, [note]),
    el("pre", { class: "commands__pre" }, [el("code", {}, [commands.join("\n")])]),
  ]);
}

function copyButton(card: ComposeCard): HTMLElement {
  const button = el("button", { type: "button", class: "copy" }, ["Copy all commands"]);

  button.addEventListener("click", () => {
    const script = composeScript(card);
    void navigator.clipboard
      .writeText(script)
      .then(() => {
        button.textContent = "Copied — read it before you run it";
      })
      .catch(() => {
        button.textContent = "Copying was blocked; select the text above instead";
      });
  });

  return button;
}

/** The deployment card for one release. */
export function releaseDetailView(record: ReleaseRecord): HTMLElement {
  const card = composeCard(record);

  return el("section", { class: "panel" }, [
    el("p", { class: "breadcrumb" }, [el("a", { href: "#/releases" }, ["← All releases"])]),
    el("h1", {}, [record.release.tag]),
    el("p", { class: "panel__lede" }, [record.release.name]),

    coverageLine(record),

    el("div", { class: "card" }, [
      el("h2", {}, ["Run this release locally with Docker Compose"]),
      el("p", { class: "card__note" }, [
        "These commands are generated text. This page runs nothing, connects to nothing ",
        "but the GitHub API, and has no way to reach your machine — you copy them and run ",
        "them yourself.",
      ]),
      ...(card.kind === "refused"
        ? [el("p", { class: "card__refused" }, [card.reason])]
        : [
            ...card.blocks.map((block) => commandBlock(block.title, block.note, block.commands)),
            copyButton(card),
            el("p", { class: "card__requirements" }, [
              "Requires git, Docker with the Compose plugin, and make. The stack is ",
              "PostgreSQL plus the CloFin service, on synthetic data.",
            ]),
          ]),
    ]),

    el("div", { class: "card" }, [
      el("h2", {}, ["The release body, as published"]),
      el("p", { class: "card__note" }, [
        "Shown in full and unedited, so the coverage line above can be checked against ",
        "its source.",
      ]),
      el("pre", { class: "body__pre" }, [el("code", {}, [record.release.body || "(no body)"])]),
      el("p", {}, [
        el("a", { href: record.release.htmlUrl, rel: "noopener noreferrer" }, [
          "This release on GitHub →",
        ]),
      ]),
    ]),
  ]);
}

/** Something went wrong, said plainly. */
export function errorView(error: unknown): HTMLElement {
  const explanation =
    error instanceof RateLimited
      ? [
          error.message,
          error.resetAt ? ` The limit resets at ${error.resetAt.toLocaleTimeString()}.` : "",
        ].join("")
      : error instanceof BlockedOriginError || error instanceof HttpError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

  return el("section", { class: "panel" }, [
    el("h1", {}, ["The releases could not be read"]),
    el("p", { class: "error" }, [explanation]),
    el("p", {}, [
      "Nothing is cached and nothing is stored, so there is no stale copy to show ",
      "instead. Reloading is the only retry.",
    ]),
  ]);
}

/** The first paint, before the API answers. */
export function loadingView(): HTMLElement {
  return el("section", { class: "panel" }, [
    el("h1", {}, ["Releases"]),
    el("p", {}, ["Reading the GitHub Releases API…"]),
  ]);
}

/** A tag in the URL that no release matches. */
export function notFoundView(tag: string): HTMLElement {
  return el("section", { class: "panel" }, [
    el("p", { class: "breadcrumb" }, [el("a", { href: "#/releases" }, ["← All releases"])]),
    el("h1", {}, ["No such release"]),
    el("p", {}, [`${CORE_REPO.name} has no published release tagged ${tag}.`]),
  ]);
}
