# ADR-0001: TypeScript on a `tsc`-only toolchain, with no framework and no bundler

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Worker session for TASK-011, under the operator's D1/D2 ruling
- **Supersedes / Superseded by:** —

## Context

[ADR-0026 in `clofin-core`](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0026-three-repositories-and-the-cockpits-role-boundary.md)
moved the operator interface out of `clofin-core` so that its
[ADR-0004](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0004-minimal-dependency-footprint.md)
minimal-dependency doctrine and its NFR-007 could stay unqualified. That
decision hands this repository a choice and a warning in the same breath: the
frontend toolchain decision is ours, and the reason we were given it is that
frontend toolchains are large.

This repository does **not** inherit ADR-0004. It is a different repository
with a different job, and a rule written for a payments ledger is not
automatically right for a browser client. But it inherits the instinct, and it
inherits something ADR-0004 did not have to think about: two of this
repository's obligations are *checks over its own built output*.

- `scope-verbatim` compares the scope statement in the built site against a
  canonical constant, byte for byte.
- `no-unqualified-audited` reads the built site's text and fails on any
  sentence calling a release audited, verified or reviewed without saying what
  the audit covered.

Both checks get harder and less trustworthy the more code in the output was
written by somebody else. A framework's runtime ships thousands of strings this
repository did not author and cannot vouch for; every one of them is either a
false positive waiting to happen or a hole the check has to be widened to
accommodate. A widened check is the partial guard that `clofin-core`'s standing
lesson **L-6** exists to warn about.

What actually has to be built in this increment is also worth stating plainly,
because it bounds the answer: a list, a detail page, a block of generated shell
text, and a header that never changes. There is no client-side state beyond
"which release is selected", no form, no optimistic update, no collaborative
editing — nothing a virtual DOM was invented to make tractable.

One further force, particular to this repository. The cockpit's entire claim is
that it owns no truth and computes nothing. A reader who wants to check that
claim should be able to check it — and the most direct way is to read the code
that rendered the page they are looking at.

## Decision

**TypeScript, compiled by `tsc` to plain ES modules, served as static files.
No framework, no bundler, no minifier, and no runtime dependencies at all.**

Concretely:

| Choice | What it is |
|---|---|
| Language | TypeScript, `strict` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` |
| Build | `tsc` → ES modules, plus a copy of `static/`, plus a build-time render of the honesty frame |
| Runtime dependencies | **none** |
| Development dependencies | `typescript`, `@types/node` — **3 packages** installed in total, `undici-types` being the only transitive one |
| Tests | `node:test` and `node:assert`, from the Node standard library |
| Module loading | native `<script type="module">`; the browser resolves the imports |
| Output | unminified, comments intact |

`removeComments` is deliberately `false`. What is deployed is this repository's
code with its types erased — so "view source" on the published page shows the
same commented modules a reviewer would read here, including the module that
renders the scope statement and the module that refuses to parse a coverage
paragraph it does not understand. For an artifact whose product *is* its
honesty, a readable deployed site is worth more than a smaller one. The site is
a few tens of kilobytes either way.

The type system is used to carry the rules rather than to describe them:
`provenanceFields` returns a three-element tuple so that a view cannot render a
tag without its coverage, and `parseCoverage` returns a discriminated union so
that a caller cannot read a status the parser did not find.

## Alternatives considered

| Option | Why it was rejected |
|---|---|
| **React and Vite** — what `clofin-core`'s ROADMAP predicted for increment 8 | The prediction was made before the cockpit had two checks over its own built text. React plus Vite is roughly 200 packages for a four-view application with one piece of state; every one of those packages ships strings into an output that `no-unqualified-audited` reads. The virtual DOM solves a problem this interface does not have, and the bundle it produces cannot be read by the person being asked to trust it |
| **Svelte or SvelteKit with a static adapter** | Genuinely small output, and the compiler removes itself — the strongest of the framework options. Rejected because the output is *generated* code: what ships is not what anyone reviewed, which forfeits the readable-source property, and because a compiler toolchain is a large dependency to take on for a list and a card |
| **Vite with vanilla TypeScript** (no framework, but bundled) | Keeps zero runtime dependencies but adds ~20 development packages and minifies the output, losing readable source and gaining nothing: with native ES modules over HTTP/2 there is no bundle to be won for a dozen small files |
| **No build at all — hand-written JavaScript in `static/`** | The simplest possible answer, and it was close. Rejected because the coverage parser is the one place where a silent bug becomes a false honesty claim — a release rendered as covered when it is not — and types plus a compile step are cheap insurance for exactly that function. It would also leave the scope statement duplicated between the HTML and the code, and one copy is the whole point |
| **Next.js static export, or another meta-framework** | A server framework's mental model and dependency tree for a site with no server. The static export would be the only feature used |
| **A markdown renderer for release bodies** | The most tempting runtime dependency here, since release bodies are markdown. Rejected: the body is shown as preformatted text exactly as published, which is more honest than rendering it — the reader can compare the coverage line the cockpit parsed against the untouched paragraph it came from. A renderer would also be an HTML-injection surface fed by a remote document |
| **A test framework (Vitest, Jest)** | `node:test` covers what is needed and is already installed with Node. A test framework would be the largest dependency in the repository, in service of the part of it nobody deploys |

## Consequences

**Positive**

- Three packages in the toolchain, none at runtime. `npm audit` reports nothing
  because there is almost nothing to report on, and a lockfile a person can
  read in one screen is a supply chain a person can actually check.
- The two checks scan code this repository wrote, all of it. Neither had to be
  widened to tolerate a vendor bundle, so neither has a hole in the shape of one.
- The published site is readable. The claim "this page computes nothing about
  payments" can be verified by reading the page's own source.
- The build is `tsc` plus a copy plus a guard — about a hundred lines of Node
  with no configuration format to learn, and nothing that can break because an
  ecosystem moved.

**Negative / accepted cost**

- No component model. If the cockpit grows the interactive surface the README
  describes — operation flows, scheme simulation by hand — hand-written DOM
  code will get harder, and this decision should be revisited **then**, with
  that code in front of us, rather than pre-emptively now.
- No hot module reloading; the developer loop is `npm run build` and a refresh.
- `@types/node` is a development dependency for the sake of the test runner's
  types alone.
- Unminified output is larger. At this size the difference is not worth the
  property it would cost.

**Risks and how they are mitigated**

- *Risk:* "no dependencies" becomes a dogma that leads to re-implementing
  something subtle and getting it wrong. *Mitigation:* the rule is not "never
  add one" — it is that a runtime dependency needs an ADR in this series
  saying what it buys. The DOM helper this repository does write is thirty
  lines and sets text with `textContent`, which is less code than the escaping
  a template engine would have required.
- *Risk:* native ES modules mean many small requests. *Mitigation:* a dozen
  files over HTTP/2 on GitHub Pages; if that ever measures badly, bundling can
  be added without changing a line of application code, because nothing in
  `src/` depends on how it is served.
- *Risk:* browsers without ES module support. *Mitigation:* accepted. Every
  browser released since 2018 has them, and the honesty frame is static HTML
  that renders regardless.

## Verification

- `npm ls --all` lists three packages, and `package.json` records exact
  versions rather than ranges. `package-lock.json` is committed.
- `dependencies` in `package.json` is absent: there is no runtime dependency to
  list.
- `tools/guard-network.mjs` runs inside the build and refuses to emit a site
  that loads a subresource from another origin — so a CDN or a web font cannot
  be introduced without the build failing, whatever a future contributor's
  intentions.
- `npm run build` runs the test suite first; a site cannot be produced from
  code whose parser is broken.
