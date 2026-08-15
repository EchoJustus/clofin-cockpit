# clofin-cockpit

The operator cockpit for [CloFin](https://github.com/EchoJustus/clofin-core) —
a **transparent client** for deploying and driving a synthetic-data reference
instance of an enterprise payments and reconciliation core.

**This repository owns no truth, holds no funds, and enforces no controls.**
It is a client of the CloFin API. Everything it displays is a real response
from a real running instance; everything it deploys is a tagged release of
`clofin-core`; anything it says about what a control *guarantees* is a verbatim
quotation from that repository's audited documents.

## Status

**Phase 2 is built: the cockpit connects to a CloFin instance you started and
bootstraps a synthetic organisation through the real API, showing every request
and every response.**

The governing architecture decision is
[`ADR-0026`](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0026-three-repositories-and-the-cockpits-role-boundary.md)
in `clofin-core`, which amends `ADR-0020` and records the ruling that made
CloFin three repositories. Talking to a running instance additionally needed a
decision in `clofin-core` itself —
[`ADR-0027`](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0027-browser-clients-cors-allowlist-and-instance-self-identification.md),
a **default-closed** CORS allowlist and a self-reported `sourceCommit` on
`GET /`. An instance sends no CORS header at all unless its operator names an
origin, so connecting to one means setting `CLOFIN_CORS_ALLOWED_ORIGINS` on it
first.

**What phase 2 added:**

- **Connect to an instance.** You give a base URL; the cockpit asks it
  `GET /` and `GET /readyz` and shows what it answered — its own disclaimer
  verbatim, its environment, its schema version, and its source commit labelled
  **self-reported**. A tag and that release's audit coverage appear beside the
  commit **only when the commit matches a real tag's commit** from the GitHub
  Tags API; when it matches none, or when the tag list could not be read, the
  cockpit says so instead of showing a tag.
- **An instance that does not say what it is, is refused.** If `GET /` carries
  no disclaimer field, the cockpit will not connect: it does not drive systems
  that do not identify themselves. The raw response is shown with the refusal.
- **Seed profiles and a bootstrap runner.** Versioned JSON documents in
  [`profiles/`](profiles) declare every call a run will make, one step per
  call. The runner executes them strictly in order against your instance and
  **halts on the first failure, naming the step**, with everything before it
  visible and nothing after it attempted. Every step shows the raw request and
  the raw response, and the equivalent `curl`.
- **Where CloFin has no endpoint, the cockpit says so.** There is deliberately
  no API that creates an actor, grants a role, sets an approver limit or
  configures an approval threshold — an actor able to grant itself the approver
  role would make segregation of duties unenforceable. Those steps generate the
  exact SQL for you to run against your own instance, and then **ask the API**
  whether it landed. A step is never marked done because a button was pressed,
  and every step states plainly what its check cannot demonstrate.
- **Re-running does not create anything twice.** The chart of accounts is read
  before each account is opened, and the organisation's short name is unique on
  the instance, which refuses a second one. Neither path skips silently: both
  render, with the instance's own answer.

**What exists from phase 1**, as a static single-page application published to
GitHub Pages — no server, no telemetry, no analytics, no third-party CDN:

- **The honesty frame.** The scope statement quoted below is written once, in
  one constant, rendered into the page at build time, and shown in-frame and
  non-dismissible on every view. It is static markup, so it is there before any
  script runs and stays there if none ever does.
- **The release browser.** `clofin-core`'s `ref-<n>` releases, read from the
  public GitHub API without any credential. Each release shows its tag, its
  commit SHA and its release-audit coverage **together** — the coverage parsed
  out of the release body's `RELEASE AUDIT:` paragraph, never typed here. The
  parse fails closed: a body it cannot read renders as *"coverage statement not
  found"*, never as a blank and never toward any word like audited. `ref-1`
  reads as `PARTIAL — charter items 1-4 of 8`.
- **The Compose deployment card.** For a selected release, the exact commands
  to run that release locally, pinned to the tag and verifying the commit.
  Generated text only — this page executes nothing and cannot reach your
  machine.
- **Two automated checks**, and deliberately no third: `scope-verbatim`
  compares the rendered scope statement with its canonical constant and with
  this README's quotation, byte for byte; `no-unqualified-audited` fails the
  build on any text calling a release audited, verified or reviewed without
  saying what the audit covered. The build itself refuses to emit a site that
  could contact any origin but `api.github.com`.
- **[`docs/ADR/0001`](docs/ADR/0001-typescript-on-a-tsc-only-toolchain-without-a-framework.md)**,
  recording the toolchain: TypeScript compiled by `tsc`, no framework, no
  bundler, and no runtime dependencies.
  **[`docs/ADR/0002`](docs/ADR/0002-the-build-guard-evolves-forms-are-permitted-and-what-still-is-not.md)**
  records what phase 2 changed about the build's refusals, and what it
  deliberately did not.

**What this page stores.** One thing: the base URLs and labels of instances you
have connected, so you do not retype them. Nothing else — and the build refuses
to publish a site in which any browser storage API is named outside the single
module that keeps that list.

**What this page contacts.** Its own origin, `api.github.com`, and instances you
have connected. The permitted shapes of instance address — a port on your own
machine, or a GitHub Codespace's forwarded port — are one constant in
[`src/origins.ts`](src/origins.ts), from which the page's
`Content-Security-Policy` is generated at build time, so the browser refuses
what the code refuses.

**What is still gated.** Operating flows — create → submit → approve → settle,
statement ingestion, working the breaks, and playing the simulated scheme by
hand — are phase 3. The Codespaces and Actions-runner drivers are later phases
still.

**No credential is handled here.** No GitHub token is asked for, stored or
sent; every GitHub read is anonymous, and the build fails if a token header or
a token name appears in the output. The synthetic actor ids a bootstrap run
creates are a different thing and are treated as credentials anyway: minted in
your browser, held for the life of the tab, sent only to the instance they were
minted for, dropped when you forget that instance — and the build refuses to
publish any file containing one.

## Role in the CloFin ecosystem

| Repository | Role | Owns truth? |
|---|---|---|
| [`clofin-core`](https://github.com/EchoJustus/clofin-core) | The system, its controls, its documents — the release-audit subject | **All of it** |
| [`clofin-trace`](https://github.com/EchoJustus/clofin-trace) | Replay of the **past** — captured output of a tagged release, presentation only | No |
| `clofin-cockpit` | Interaction with the **present** — a client that deploys and drives a real instance | No |

`clofin-trace` may never fake; the cockpit may never claim. The trace replays
what really happened; the cockpit does things for real and shows you exactly
what the system answered.

## What it will do

- **Releases** — browse `clofin-core`'s `ref-<n>` releases, always showing the
  tag, the commit SHA and that tag's **release-audit coverage** together, read
  from the release itself, never typed.
- **Deploy** — one-click provisioning of a reference instance from a tagged
  release: locally via Docker Compose, interactively via GitHub Codespaces, or
  as a scripted batch run on a GitHub Actions runner (which has no inbound
  network, so it runs scenarios and uploads their output rather than hosting a
  session — stated here because the interface will state it too).
- **Accounts** — bootstrap of a synthetic organisation: actors and roles, a
  chart of ledger accounts, per-currency approval thresholds, from versioned
  seed profiles in this repository. **Built** — and it is not one click: it is
  one step per request, each shown in full, with the steps CloFin has no
  endpoint for generated as SQL you run yourself and then confirmed through the
  API.
- **Operate** — run the UAT flows against the live instance (create → submit →
  approve → settle; ingest a statement → work the breaks), and **play the
  simulated scheme by hand**: settle, return, contradict, duplicate, or go
  silent on individual items and watch the real system respond. Every action
  shows the raw API request it makes and the raw response it receives.

## The rules this repository lives under

1. **It drives the real API and displays real responses.** No value shown here
   is computed, simulated or animated by this repository.
2. **Control claims are quotations.** Any statement about what CloFin
   guarantees is quoted verbatim from `clofin-core`'s `COMPLIANCE.md` or
   `DOMAIN_MODEL.md`, attributed and linked at the deployed commit.
3. **No secrets live here.** The current phase handles no token at all — every
   GitHub read is anonymous. When a later phase introduces a token you supply,
   it will stay in your own browser session; CloFin credentials are synthetic,
   per-instance, minted in your browser and held only for the life of the tab
   that minted them; and this repository's history contains no credential of
   any kind.
4. **The scope statement below renders in-frame on every screen**, beside the
   deployed instance's tag, commit and release-audit coverage.

## Scope

Quoted verbatim from the CloFin system's own `GET /` response:

> CloFin operates on synthetic data only. It is not connected to any bank,
> payment scheme or central bank, holds no regulatory authorisation, and
> never processes real funds.

The cockpit deploys and operates **reference instances for demonstration and
evaluation**. It is not production operations tooling, it is not a payment
system, and no deployment it performs handles real money or reaches any real
financial infrastructure.

This repository is outside `clofin-core`'s release-audit scope: it makes no
control claims of its own, and the honesty of what it displays is inherited
from the audited API it calls.

## Licence

Eclipse Public License 2.0 — see [LICENSE](LICENSE), matching `clofin-core`.
