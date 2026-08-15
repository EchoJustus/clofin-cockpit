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

**Phase 4 is built: the same walk now runs as a batch.** A `workflow_dispatch`
in this repository checks `clofin-core` out at a tag or commit you name, starts
it against a real PostgreSQL, executes a scenario end to end **through this
cockpit's own runner**, and writes every step — the actor, the raw status, and
every figure in minor units — into the run's job summary, which GitHub serves to
anybody with the link and no credential.

**Phase 3 is built: the cockpit walks the whole product against a live instance
— a payment refused to its own creator, the simulated scheme played by hand,
reconciliation through a rejected correction to a posted entry, and every
touched subject's audit evidence one click away.** Every figure on every screen
is a value the instance returned.

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

**What phase 4 added:**

- **A scenario, run as a batch, against any tag.** `Actions → Scenario run`
  takes three inputs — the `clofin-core` ref, which scenario, which seed
  profile — checks that ref out **read-only**, resolves it to a full commit,
  starts the stack (`make up`, with the 012/013 host-run fallback if the image
  will not build, stated either way), and runs everything the scenario depends
  on in order.
- **The same runner, headlessly.** The batch entry point drives
  [`src/bootstrap.ts`](src/bootstrap.ts) — the same reader, the same four-state
  vocabulary, the same actor gate, the same figures module. There is no second
  engine. Two differences are declared and recorded in
  [`docs/ADR/0004`](docs/ADR/0004-the-headless-entry-two-declared-differences-and-a-playbook-that-cannot-invent-an-answer.md):
  the workflow runs a manual step's SQL itself and **still confirms it through
  the API**, and choices are answered from a versioned playbook.
- **A playbook, and the answer it will not invent.** Every choice a batch run
  makes is declared beforehand in [`playbooks/`](playbooks) with the reason,
  and the summary renders each as *declared → performed → what the instance
  answered*. **A choice the playbook does not answer stops the run**, in the
  same `waiting for you` state you would see on screen, and fails the job naming
  the step. There is still no auto-play in the browser: the playbook is a batch
  construct and is not even served beside the page.
- **The evidence is the summary.** It opens with the scope statement and the
  resolved 40-character commit, carries that tag's release-audit coverage read
  from the release body, and prints every step's actor, raw status and figures
  in **verbatim minor units** — which the run then re-checks against the bodies
  they came from, failing the job if one does not appear there.
- **A batch-runs page**, describing all of that, linking to the workflow on
  github.com — dispatching is a github.com action, because this cockpit holds no
  token — and listing recent runs from an anonymous read, or saying what GitHub
  answered instead. It never asks for a token.

**What phase 3 added:**

- **The acting actor, in the frame.** Whose `X-Actor-Id` the next request will
  carry is shown beside the scope statement on every screen, and every step
  records which actor made it. Switching is an explicit click: a step that
  belongs to somebody else **sends nothing at all** — not even a precheck — and
  waits for you to hand over. Nothing switches on your behalf, including the
  evidence view, which says which actor it will become before it does.
- **The payment flow, with the refusal shown for real.** Three payments are
  raised and submitted by the maker; she then attempts to approve one herself
  and the instance refuses her with a `403` carrying `reason: self-approval`,
  rendered body and all, with her name in the frame beside it. A checker
  approves, a controller batches and releases, and the clearing exposure appears
  in `1300-IN-TRANSIT`.
- **Playing the simulated scheme by hand.** For a released batch you are the
  scheme: settle an item, deliver the same message again and watch it replay,
  answer a second item and then contradict that answer and watch the `409` keep
  its receipt, say nothing at all about a third, sweep the timeout, and send the
  late answer. **One deliberate click per response.** There is no macro, no
  auto-play and no timer — a control that produced misbehaviour on its own would
  make this a demo reel rather than an operator console. `SIM-` names render
  exactly as they are sent and returned.
- **Balances re-read, never adjusted.** After every scheme response the three
  account balances are read again from real statement calls, and each figure is
  shown with the response it came from directly beneath it. Minor units are
  printed as the instance sent them — `{"currency":"SGD","minorUnits":150000}`,
  not `SGD 1,500.00`, because that conversion would be arithmetic this
  repository performed on a number it claims not to compute.
- **The reconciliation flow.** The scheme's own statement is generated and
  posted straight back — the document the instance returned, unchanged, with
  your organisation id added — matching every line with its rule id. Then a
  deliberately perturbed statement opens a break with its kind and its detail;
  the break is assigned, a correction is proposed, its proposer is refused when
  he tries to approve it himself, a checker **rejects it with a reason**, and a
  second correction is approved and posts a journal entry that resolves the
  break.
- **The evidence view.** For any subject a flow touched, its evidence pack and
  its audit events from the real endpoints, one click from the step that touched
  it — both answers rendered exactly as they arrived.
- **A figure cannot originate here.** [`src/figures.ts`](src/figures.ts) is the
  only path by which a value in a response becomes a number on the screen, and
  it contains no arithmetic. A test asserts every projected figure appears
  verbatim in the body it was read from, and the build refuses to publish a site
  containing a number formatter or arithmetic on a money-carrying member.

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
  **[`docs/ADR/0003`](docs/ADR/0003-operating-a-live-instance-one-runner-explicit-actors-and-figures-that-are-never-computed.md)**
  records phase 3: one runner rather than two, the acting-actor invariant, the
  `choice` step and why there is no macro, and how "computes no figure" is
  enforced rather than promised.
  **[`docs/ADR/0004`](docs/ADR/0004-the-headless-entry-two-declared-differences-and-a-playbook-that-cannot-invent-an-answer.md)**
  records phase 4: the headless entry driving that same runner, the two declared
  differences and their reasons, and why a playbook that does not answer a
  choice stops the run rather than picking one.

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

**What is still gated.** The Codespaces driver and any handling of a GitHub
token are later phases. The Actions scenario runner arrived in phase 4 and
**handles no token either**: dispatching a run is something you do on
github.com, signed in as yourself, and reading a run's results uses only what a
public repository serves anonymously — its job summary, which is where a run
writes everything. Rule 3 below therefore stays forward-tensed.

**What the flows cannot show, and say so.** Every flow carries its own list, on
screen, before it is run. Two are worth naming here. A retried submission's
`Idempotent-Replayed` header — the evidence UAT-004 turns on — is **not** in
this instance's `Access-Control-Expose-Headers`, so no browser page can read it;
the `curl` beside every step reproduces the request in a terminal where it is
visible. And the timeout path shows that CloFin **stopped waiting**, never what
happened to the money: the payment stays `released`, its value stays in
`1300-IN-TRANSIT`, and nothing here converts unknown into failed.

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
  as a scripted batch run on a GitHub Actions runner. The batch form is
  **built**: a runner has no inbound network, so it runs a scenario and
  publishes the evidence rather than hosting a session — into the job summary,
  which is served without a credential, rather than into an artifact, which is
  not.
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
  **Built** — three flow documents in [`profiles/`](profiles), one deliberate
  click per scheme response, and the three account balances re-read from the
  instance after every one.
- **Evidence** — for any subject a flow touched, its audit events and its
  evidence pack from the real audit endpoints, one click from the step that
  touched it. **Built.**

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
