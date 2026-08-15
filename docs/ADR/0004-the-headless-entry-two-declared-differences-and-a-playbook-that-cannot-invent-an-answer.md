# ADR-0004: The headless entry — two declared differences, and a playbook that cannot invent an answer

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Worker session for TASK-014, inside the role boundary
  [`clofin-core` ADR-0026](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0026-three-repositories-and-the-cockpits-role-boundary.md)
  draws
- **Supersedes / Superseded by:** — · **Extends:** [ADR-0001](0001-typescript-on-a-tsc-only-toolchain-without-a-framework.md), [ADR-0002](0002-the-build-guard-evolves-forms-are-permitted-and-what-still-is-not.md), [ADR-0003](0003-operating-a-live-instance-one-runner-explicit-actors-and-figures-that-are-never-computed.md)

## Context

Phase 3's walk is real and it costs a person twenty minutes, a local stack and
a browser. Phase 4 runs the same walk as a **batch**: a `workflow_dispatch`
checks `clofin-core` out at a named ref, starts it against a real PostgreSQL,
executes a scenario end to end, and writes the evidence into a job summary that
a public repository serves to anybody with the link.

Four things about that are not obvious, and each one is a way the increment
could have gone wrong.

1. **Nobody is watching.** Every honesty property ADR-0003 built exists because
   a person can see the screen. In a batch nobody can, which makes the
   properties matter *more* and makes them cheaper to quietly drop.
2. **A batch has no operator, and the runner stops for one three times** — an
   actor hand-over, a manual step's SQL, and a choice. Each needs an answer
   that is not "guess".
3. **A choice is the one thing this cockpit has refused to decide.** ADR-0003
   spent a section on it: what a simulated scheme says next is a fact about the
   world, and a control that produced it on a timer would make the product a
   demo reel. A batch run cannot click, and the tempting resolutions — first
   option, the option the prose leans toward — are all the same defect.
4. **The audit subject is frozen.** The run drives `clofin-core` at a tag whose
   release audit is the reason it may not be edited.

## Decision

### 1. One runner, headlessly — the same one, not a compatible one

`headless/run.ts` is an **entry point**, not an engine. It reads documents with
`profiles.ts`, starts and advances them with `bootstrap.ts`, holds identity in
`acting.ts`, makes every request through `net.ts`, connects through
`instance.ts`'s honesty gate, and projects every figure with `figures.ts`. It
contains no request, no expectation rule, no status vocabulary and no
arithmetic.

`headless/drive.ts` is the operator's hands and nothing else. Its whole logic is
what to do when the runner reports `waiting for you`.

The four-state vocabulary moved from `views-run.ts` to `bootstrap.ts` in this
increment, so the run screens and the batch summary render the same word for
the same state from **one table**. It was a private constant in a view module,
which was fine while there was one reader and is exactly how a vocabulary
becomes almost-shared.

### 2. Two declared differences, and only two

Everything else is identical to a browser run. These two are not, and both are
rendered in the summary on every step they touch.

**(a) A manual step's SQL is run by the workflow.** CloFin has no endpoint that
creates an actor or sets a threshold, deliberately, so the runner generates SQL
and the operator runs it. In a batch the workflow *is* the operator — it started
the database minutes earlier and it is the only thing that can reach it — so it
pipes the statements the runner generated into `clofin-core`'s own composed
PostgreSQL.

**The confirmation half does not change.** `verifyManualStep` runs, as the actor
the profile names, and the step advances on the instance's answer. The summary
prints the command, the statements, and then the request the status rests on,
under the words *performed by the workflow, confirmed by the instance*. A step
that showed only the first half would be reporting that a command was issued,
which is not the same fact as the row existing.

**(b) A choice is answered from a versioned playbook.** A playbook is a JSON
document in `playbooks/`, committed and diffable, declaring every answer **with
the reason, before the run**. The summary renders each one as *declared →
performed → the instance answered*.

The honesty argument is not that this is as good as a click. It is that a
batch's honesty is a different thing from a demonstration's: an interactive walk
is honest because you watched the decision being made, and a batch run is honest
because the decision was written down in public *before* anybody knew what it
would produce. The declaration is in the repository, the outcome is in the
summary, and they are printed together.

### 3. The playbook cannot invent an answer, and that is enforced by halting

A choice the playbook does not answer **stops the run**. The runner stays in
`waiting for you` — the same state, for the same reason — and the job fails
naming the step and listing the options it did not choose between.

There is no default option, no first-one-wins, and no ordering rule. The
cross-check that runs before the first request deliberately does **not** require
a playbook to cover every choice: an incomplete playbook is a legal document,
and making it illegal here would replace the behaviour worth demonstrating with
a message about it. `drive.test.ts` asserts the halt by **counting requests at a
stubbed fetch**, so "nothing was sent" is measured rather than read off a status.

The playbook also cannot change a request. An answer is a step id and an option
id, both of which must already exist in the flow; method, path, body, expected
statuses and readouts stay in `profiles/`.

**`playbooks/` is not copied into the built site.** The browser cannot fetch one
even if a future view tried. Auto-play in the browser stays refused: this
document exists because a batch has no operator, not because clicking was
inconvenient.

### 4. The actor gate is not a third difference

A step belonging to somebody else still sends nothing at all. The driver then
performs the same explicit act a person performs — `actAs`, the function the
browser's switcher calls — and asks again. The invariant is untouched: a request
carries the acting actor's id, and the acting actor changes only by an explicit
operator action. What changed is who the operator is, and every hand-over is
recorded and printed with the step that required it.

### 5. Figures are checked twice, and the second time by the run itself

`figures.ts` projects; `figures.test.ts` asserts verbatim-ness against recorded
bodies at build time. A batch run additionally re-checks **every figure it is
about to publish** against the live body it came from, and **fails the job** if
one is not a substring of its own source. A figure the instance did not send
reports as absent rather than as zero, and that is not a failure — treating it
as one would push the next contributor toward inventing a value.

### 6. The summary opens with the frame, and states its provenance in full

Scope statement first, from the one constant, above anything worth
screenshotting. Then the requested ref, the **resolved 40-character commit**,
and that commit's release-audit coverage — matched by `releases.ts` and
`coverage.ts`, the same modules the release browser uses, from the release
body's own `RELEASE AUDIT:` paragraph. A body those modules cannot read renders
as *coverage statement not found*, never as anything reassuring.

Where the release documents came from is **printed rather than assumed**. The
workflow asks the public API with no credential first, exactly as the page does;
if that is refused it re-asks with the automatic job token and the summary says
so in the same table. A hosted runner shares its address and GitHub's
unauthenticated allowance is per address, so that fallback is about somebody
else's traffic rather than about this repository's convenience — and a coverage
line that read *not checked* for that reason would be a worse artifact than one
that says exactly how it was obtained.

### 7. No token in the site, and the anonymous read is asked rather than assumed

Dispatching is a **github.com action**. The batch-runs page says so and links to
the workflow; there is no token field anywhere and `runs.ts` has no path that
could ask for one.

Reading uses what a public repository serves anonymously. The page asks the
public API for recent runs and renders **either the list or GitHub's own answer
as the reason there is none**. The workflow makes the same request and records
what came back, distinguishing a refusal from a spent allowance — those are
different answers, and reporting the first when the second happened would be
claiming to have settled a question this repository did not.

### 8. Still exactly two checks, over more files

`scope-verbatim` and `no-unqualified-audited` now also walk `headless/` and
`playbooks/`. Those directories are not in the built site, but what they produce
is a **public summary about what a tagged release did and what its audit
covered** — the likeliest place in this repository for an unqualified claim, read
by people who never open the site. Same rule, more files; no third check. The
extension found a real unqualified sentence in `headless/run.ts` on its first
run, which is recorded in `014-REQ`.

### 9. The frozen core, structurally

The workflow holds `contents: read`, both checkouts discard their credentials,
and no step commits, pushes, tags or comments. There is no path by which a
scenario run edits the audit subject.

## Alternatives considered

| Option | Why it was rejected |
|---|---|
| **A purpose-built batch runner** | Far easier: no actor gate to satisfy, no waiting states to interpret. It would be a second place for the halting rule, the four states and the raw-exchange discipline to be *almost* implemented — in the one setting where nobody is looking at the screen |
| **Put the headless entry in `src/`** | It would compile into the published site: node imports, a database client and a summary writer shipped to a browser. `tsconfig.headless.json` keeps it out structurally rather than by a rule somebody has to remember |
| **Take the first option at a choice** | The whole of ADR-0003 §4 in reverse. It would also be invisible: a summary showing `settle` cannot be told from one where somebody chose it |
| **Require a playbook to answer every choice, and refuse otherwise** | Tidier, and it would delete the behaviour worth having. The halt *is* the demonstration; a pre-flight refusal replaces it with a lint message |
| **Let the playbook carry a request body or an expected status** | Then a playbook could relax a `409` into a `200` and the run would still look green. It carries answers only, and both are checked against the flow before the first write |
| **Serve the playbook beside the page** | It would be one fetch away from a browser auto-play button. It is not copied into the site at all |
| **Skip a manual step in a batch, since there is no operator** | The step would report done without anything being confirmed. The workflow runs the SQL and the instance still says whether it landed |
| **Upload the evidence as a build artifact** | Artifacts are not served anonymously, so the evidence would need a credential to read — which is the rule this phase is built around. The summary is public; that is why it carries everything |
| **A token in the page, so it could dispatch** | The phase that introduces a token is its own decision, and it is about how one is handled rather than a convenience added to this one |
| **A schedule, so runs happen nightly** | A scenario run is a deliberate act with a person behind it. Unattended runs against a fixed tag re-prove the same thing and burn minutes |
| **A third CI check for the batch runner** | ADR-0026's reasoning is unchanged. The existing two were extended over the new files instead |

## Consequences

**Positive**

- The walk is reproducible against any tag by anybody with a GitHub account,
  and its evidence is readable by anybody at all.
- Every answer a batch run gives is in the repository before the run, so a
  reader can disagree with the *plan* rather than only with the result.
- "The cockpit computes no figure" gains a third enforcement that runs against
  live responses.
- One vocabulary table, one runner, one figures module — now shared by a browser
  and a server, which is a stronger statement of "one runner" than the browser
  alone could make.

**Negative / accepted cost**

- A scenario run needs a **fresh instance**. `POST /organisations` refuses a
  second organisation with the same short name and CloFin has no lookup by short
  name, so a second run against the same database stops at step 1 — correctly,
  and the summary says so. Each dispatch starts its own database.
- The summary is long. Raw exchanges are collapsed and individually capped, and
  if the whole document would exceed what a job summary holds, they are dropped
  **with a sentence saying how many** rather than silently.
- A run on a server sees response headers a browser may not. That is a
  difference in what the reader is, not in what CloFin did, and the batch-runs
  page says so.
- The playbook is a document to maintain. A flow that gains a choice gains an
  unanswered one, and the next run stops there until somebody decides.

**Risks and how they are mitigated**

- *Risk:* a future increment makes the driver "recover" from a surprise.
  *Mitigation:* `drive.test.ts` counts requests at a stub for every halt, so a
  recovery would show up as a request that should not exist.
- *Risk:* the summary acquires a friendlier copy of the scope statement.
  *Mitigation:* `scope-verbatim` walks `headless/` and treats any near-copy as a
  full copy that must match.
- *Risk:* somebody adds a token field to the batch-runs page to fix the runs
  list. *Mitigation:* the build guard already refuses a token header or a token
  name anywhere in the output; `runs.ts` renders GitHub's own answer instead.

## Verification

- `npm run build` — 239 tests, type-check clean, network guard clean.
- Both checks green, and still two.
- The whole scenario driven end to end against `clofin-core` at `ref-1` on a
  real PostgreSQL 16, and a real dispatch of `scenario-run.yml` — both recorded
  in [`014-REQ`](https://github.com/EchoJustus/clofin-core/blob/main/docs/audits/014-REQ-cockpit-scenario-runner.md).
- Negative controls, each run for real and recorded there: a playbook missing
  one answer (the run stops at that choice and the job fails, naming it); a
  second run against the same database (stops at `create-organisation` with the
  instance's own `409`); the extended `no-unqualified-audited` finding a real
  unqualified sentence in this increment's own code.
