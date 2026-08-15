# Architecture Decision Records — `clofin-cockpit`

An ADR captures a decision that a future contributor would otherwise have to
re-derive — including the options that were rejected and why.

**This is `clofin-cockpit`'s own series, numbered from 0001.** It is not shared
with `clofin-core`'s, and the two never renumber to accommodate each other.
Decisions about this repository — its toolchain, its dependencies, how it
renders and what it refuses to render — are recorded here, because this is the
repository that bears their cost.

Decisions about **the system** live in `clofin-core`. This repository owns no
truth and therefore records no decision about how CloFin behaves. The decision
that created this repository is
[`clofin-core` ADR-0026](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0026-three-repositories-and-the-cockpits-role-boundary.md),
which also amends
[ADR-0020](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0020-two-repositories-and-the-generate-replay-rules.md)
— the source of the three rules this repository lives under.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-typescript-on-a-tsc-only-toolchain-without-a-framework.md) | TypeScript on a `tsc`-only toolchain, with no framework and no bundler | Accepted |
| [0002](0002-the-build-guard-evolves-forms-are-permitted-and-what-still-is-not.md) | The build guard evolves — forms are permitted, and what deliberately still is not | Accepted |
| [0003](0003-operating-a-live-instance-one-runner-explicit-actors-and-figures-that-are-never-computed.md) | Operating a live instance — one runner, an explicit acting actor, and figures that are never computed | Accepted |
| [0004](0004-the-headless-entry-two-declared-differences-and-a-playbook-that-cannot-invent-an-answer.md) | The headless entry — two declared differences, and a playbook that cannot invent an answer | Accepted |

## Conventions

- Files are numbered sequentially and never renumbered.
- Status is one of `Proposed`, `Accepted`, `Superseded by ADR-nnnn`, `Deprecated`.
- An accepted ADR is **never edited to change its decision**. It is superseded
  by a new ADR that links back to it.
- **Every runtime dependency needs an ADR here.** This repository does not
  inherit `clofin-core`'s ADR-0004, but it took the same position for its own
  reasons, which ADR-0001 records. There are currently none.
- Write the ADR before the code that depends on it.
