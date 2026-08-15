# ADR-0003: Operating a live instance — one runner, an explicit acting actor, and figures that are never computed

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Worker session for TASK-013, inside the role boundary
  [`clofin-core` ADR-0026](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0026-three-repositories-and-the-cockpits-role-boundary.md)
  draws
- **Supersedes / Superseded by:** — · **Extends:** [ADR-0001](0001-typescript-on-a-tsc-only-toolchain-without-a-framework.md), [ADR-0002](0002-the-build-guard-evolves-forms-are-permitted-and-what-still-is-not.md)

## Context

Phase 2 connected to an instance and seeded one. Phase 3 operates it: a payment
moves through maker–checker to release, an operator plays the simulated scheme
by hand, a statement is reconciled, and a break is closed by an approved
adjustment. The screens now show **money moving**, which changes what the
repository is exposed to in four specific ways.

1. **A balance on screen is a claim.** Until now the cockpit displayed release
   notes and status codes. A number labelled `1300-IN-TRANSIT` is a different
   kind of object: a reader will believe it, and a reader cannot tell a value
   the instance sent from one this page derived by dividing something by a
   hundred.
2. **A refusal is only evidence if you can see who was refused.** The
   centrepiece is a payment declined to the person who raised it. A `403` with
   no actor beside it is a screenshot of a system being awkward.
3. **A simulated scheme's behaviour is not this page's to decide.** Settling,
   returning, repeating itself, contradicting itself and saying nothing are
   facts about a counterparty. A control that produced them on a timer would
   make this a demo reel.
4. **The flows are long.** Twelve steps, eight steps, twelve steps, four
   actors, three balance re-reads after every scheme response. That length is
   what makes a second runner tempting, and a second runner is where the halting
   rule and the four-state vocabulary get *almost* re-implemented.

## Decision

### 1. One runner, one document format, two roles

Flows are **profile documents** — the same versioned JSON, read by the same
reader, executed by `bootstrap.ts`. A document declares
`role: "bootstrap" | "flow"`, and the only behavioural difference is one branch
in `startRun`: a bootstrap mints the synthetic actors, a flow uses the ones
already minted for that instance and refuses to start when there are none.

`formatVersion` went from `1` to `2`, and both shipped bootstrap profiles moved
with it in the same commit rather than being read by a compatibility branch. One
format the reader implements once is the point of having a version at all.

Four step kinds now exist. `request` and `manual` are unchanged — the `manual`
pattern is the one the TASK-012 changelog ratified, generating SQL and
confirming it through a real API request that is shown, never through a button.
`choice` is new (§3). `readouts` (§2) may hang off any acting step.

### 2. Figures are projected, never derived

`src/figures.ts` is the only path by which a value in a response becomes a
number on the screen. It parses a response body, walks a declared path, and
re-serialises what it finds. It contains no arithmetic.

`{"currency":"SGD","minorUnits":375000}` renders as
`{"currency":"SGD","minorUnits":375000}`. It is **not** turned into
`SGD 3,750.00`, because that conversion is arithmetic this repository performed
and a reader could not distinguish a correct conversion from a wrong one without
redoing it. Minor units are printed as the instance sent them, with the path
they were read from beside them and the raw response directly beneath.

Three enforcements, because one is a preference:

| Enforcement | Where |
|---|---|
| A projected figure appears **verbatim** in the body it came from | `figures.test.ts` |
| No number formatter anywhere in the built output; no arithmetic operator adjacent to a money-carrying member in any module | `tools/guard-network.mjs` |
| `js/figures.js` is present in the output at all | `tools/guard-network.mjs` |

A figure that is absent reports its absence in words and never as a zero: "the
instance did not say" and "the instance said none" are different facts, and a
balance screen that collapsed them would be the defect this whole arrangement
exists to prevent.

### 3. The acting actor is a property of the page, and switching is a click

> An authenticated request carries the **acting** actor's id, and the acting
> actor changes only by an explicit operator action.

The acting actor is rendered **in the frame**, beside the scope statement, and
`main.ts` re-checks that region before and after every render exactly as it
checks the scope statement. A footer would be cropped out of precisely the
screenshot that most needs it.

A step declares `as`. If the acting actor is somebody else the step **sends
nothing at all** — not even a precheck — and reports `waiting for you` in the
ratified four-state vocabulary, halting as failure does. The runner never
switches on the operator's behalf.

This is deliberate friction at the moment the product makes its point: a maker
cannot approve her own payment, so a human hands the work over, and here that is
something you do rather than something that happens to you.

**The evidence view obeys the same rule rather than being excepted from it.**
`audit/read` is held by `auditor` and `compliance` only, so the controller who
ran the settlement cannot read the trail. The evidence control therefore says
which actor it will switch to, switches, and asks as the actor the frame now
names. A page that borrowed an identity for one request would be a page whose
frame told the truth except when it mattered.

### 4. A `choice` step, and no macro

Where the operator decides what happens — what the simulated scheme says next —
the profile declares a `choice`: a step that presents options and **performs
nothing**. Each option is one declared request; taking one costs one deliberate
click. There is no control that takes several, none that takes one for you, no
default, no highlighted recommendation and no timer.

An option may declare that it **sends nothing at all**, which is how silence is
offered. Such an option must carry a `nothingNote` saying what was not done —
enforced by the reader and again by `profiles.test.ts` — so that a step reading
`done` never stands for an outcome nobody produced. Its readouts still run, so
the operator sees the balances unmoved because the ledger is unmoved.

Some choices ship with a single option, where the steps after them are written
for one answer (a duplicate has to duplicate something specific). That is still
one deliberate click and the document says why.

### 5. A workspace, in memory, rendered before it is used

Four runs, not one, because a forty-step document is unreadable and
unrestartable. `workspace.ts` holds, per origin and in memory, the values
earlier runs captured **from responses**. A run renders what it inherited, with
the step that captured each value named, before its first request: inheritance
you can read is continuity, inheritance you cannot is hidden state. Forgetting
an instance drops it in the same call that drops the credentials, the acting
choice and the permitted origin.

### 6. The frame's own sentence was corrected

`COCKPIT_ROLE` ended "It computes nothing about payments, and it stores
nothing." The second half stopped being true in **phase 2**, when the instance
registry began storing base URLs and labels. It is corrected here, along with
"generates commands you run yourself", which stopped being the whole story once
the cockpit drove an instance directly.

A frame sentence that has quietly drifted out of true is worse than no frame
sentence, because it is the part of the page a reader is invited to rely on.
Correcting it did not wait for a later increment.

### 7. Still exactly two checks

`scope-verbatim` and `no-unqualified-audited`, extended over the three new flow
documents by putting them in `profiles/`, which both checks already walk. No
third check. The figure rules live in the **build guard**, which is not a check:
it refuses to produce a site, which is stronger than reporting on one.

## Alternatives considered

| Option | Why it was rejected |
|---|---|
| **A second runner for flows** | The flows are long, multi-actor and interactive, and a purpose-built engine would have been easier to write. It would also be a second place for the halting rule, the four-state vocabulary, the raw-exchange discipline and the actor invariant to be *almost* implemented. The brief's instruction was to extend, and it was right |
| **Format `1` kept readable alongside `2`** | A compatibility branch in the reader is a second reading of a profile, and a profile is executed against somebody's live instance. Both shipped documents were moved instead |
| **Render `SGD 3,750.00`** | It is what an operator wants to read, and it is arithmetic this repository would be performing on a value it is claiming not to compute. The raw JSON is uglier and checkable; a reader can compare it with the body directly beneath it |
| **A `formatMoney` helper confined to one module, like `figures.ts`** | The confinement would be real and the claim would still be false: the page would be displaying a number nobody sent. The guard's blunt "no formatter anywhere" has no exceptions to argue about, in the shape ADR-0002 chose for the UUID rule |
| **Infer the actor from the step, and send its id without asking** | Every request would still be honest, and the frame would still name somebody — but the two could differ, and the difference would appear exactly when a step changed hands, which is when the audience is watching. One source of identity or none |
| **Let the evidence view borrow the auditor for one request** | Shorter, and it would have made the frame a lie for the duration of two requests on the screen whose entire purpose is being believed |
| **Auto-advance a choice after a delay, or a "play the scheme" button** | This is the difference between an operator console and a demo reel. A macro that fires misbehaviour is a recording of a system, and `clofin-trace` is where recordings belong |
| **Persist the workspace, so a walk survives a reload** | The same argument ADR-0002 made about run credentials. A walk is a thing you watched happen; losing it on reload is correct, and the build refuses any storage outside the registry anyway |
| **A third CI check for the figure rules** | ADR-0026's reasoning is unchanged: this repository is entitled to two guarantees. A build that refuses to emit a site is a stronger enforcement than a check reporting on one already produced |

## Consequences

**Positive**

- "The cockpit computes no figure" is a property with three enforcements rather
  than a sentence in a README, and the negative controls for all of them were
  run.
- Who is acting is visible in every screenshot, because it is in the frame and
  the frame is checked before and after every render.
- The flows are documents. What a run will do can be read — and `curl`ed from
  the deployed site and diffed against this repository — before anything is
  sent.
- One runner, so the halting rule, the four states and the raw-exchange
  discipline exist once.

**Negative / accepted cost**

- A flow changing hands stops the run and asks. On the payment flow that is
  three interruptions. It is the intended friction and it makes the walk longer.
- The balances are minor-unit JSON. An audience wanting a currency-formatted
  figure will not get one here, deliberately.
- The flows are written against `uat-standard`'s actor keys, so an instance
  seeded with `high-value-two-approver` cannot run them. The refusal names the
  reason before anything is sent, rather than failing partway through with a
  `401`.
- The workspace lives for the life of the page. Reloading mid-walk means
  bootstrapping again, and the profiles' prechecks make that cheap rather than
  free.
- The value dates in the flow documents are literal (`2026-12-01`), as UAT-006's
  own script is. They will eventually be in the past, at which point the
  instance answers `422` naming `valueDate` and the runner renders it — a
  legible failure rather than a silent one, but a failure.

**Risks and how they are mitigated**

- *Risk:* an increment adds a helpful total or a formatted amount.
  *Mitigation:* the build refuses the formatter and the arithmetic; the test
  refuses a figure that is not verbatim.
- *Risk:* a future step sends a request under an actor the frame is not naming.
  *Mitigation:* `headersFor` reads the acting actor and nothing else — a step's
  `as` is a precondition the runner checks, never a second source of identity —
  and `bootstrap.test.ts` asserts no request goes out before the switch.
- *Risk:* a flow's prose claims more than its requests demonstrate.
  *Mitigation:* every flow carries a document-level *what this cannot show*
  list, `profiles.test.ts` requires it to be non-empty, and both checks read the
  flow documents.

## Verification

- `npm run build` type-checks, runs 200+ unit tests, emits the site and then
  **removes it** if the guard objects.
- Negative controls, each run for real and recorded in
  [`013-REQ`](https://github.com/EchoJustus/clofin-core/blob/main/docs/audits/013-REQ-cockpit-operations-and-scheme-simulation.md):
  arithmetic on `minorUnits` in a view module; a number formatter in the output;
  `figures.js` removed from the built site; and `figures.ts` altered to derive
  rather than project. The first three fail the build with the reason named; the
  fourth fails `figures.test.ts`, which runs first.
- A fifth control was run and **found a real weakness in an earlier draft of
  this guard**: a rule asserting that `figures.js` still mentioned the
  serialiser was satisfied by a *comment* mentioning it. The rule was replaced
  rather than patched, and the reasoning is in `guard-network.mjs` beside it.
  That is standing lesson **L-6**'s shape, caught by running the control instead
  of reading the rule.
- The whole walk — connect, bootstrap, payment, scheme play, reconciliation,
  evidence — driven end to end in Chromium against a live instance, with the
  origins the page contacted, the browser stores it wrote, and the rendered
  figures recorded in the `013-REQ`.
