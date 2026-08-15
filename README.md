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

**Planning. Nothing is built here yet.** This repository was created ahead of
implementation so that its scope and rules are public from its first commit.
The governing architecture decision (`ADR-0026`, in `clofin-core`) and the
first implementation phase are gated behind the `ref-2` release of
`clofin-core` and are tracked there.

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
3. **No secrets live here.** A GitHub token you supply stays in your own
   browser session; CloFin credentials are synthetic and per-instance; this
   repository's history contains no credential of any kind.
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
