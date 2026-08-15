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

**Phase 1 is built: the honesty frame and the release browser. Nothing here
calls a CloFin instance yet.**

The governing architecture decision is
[`ADR-0026`](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0026-three-repositories-and-the-cockpits-role-boundary.md)
in `clofin-core`, which amends `ADR-0020` and records the ruling that made
CloFin three repositories.

**What exists now**, as a static single-page application published to GitHub
Pages — no server, no telemetry, no analytics, no third-party CDN:

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

**What is still gated.** Everything in *What it will do* below that talks to a
running instance — deploy-and-drive, accounts, operate, scheme simulation —
waits on two things in `clofin-core`: the `ref-2` release, and a CORS decision,
which is its own reviewed change there and is not pre-approved by `ADR-0026`.
The Codespaces and Actions-runner drivers are later phases; the Compose card
establishes the driver shape first.

**No credential is handled in this increment.** Rule 3 below describes where a
GitHub token *would* live if one were ever needed; today none is asked for,
stored or sent, and the build fails if any credential handling appears in the
output.

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
- **Accounts** — one-click bootstrap of a synthetic organisation: actors and
  roles, a chart of ledger accounts, per-currency approval thresholds, from
  versioned seed profiles in this repository.
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
   it will stay in your own browser session; CloFin credentials are synthetic
   and per-instance; and this repository's history contains no credential of
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
