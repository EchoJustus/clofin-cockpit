# ADR-0002: The build guard evolves — forms are permitted, and what deliberately still is not

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Worker session for TASK-012, inside the role boundary
  [`clofin-core` ADR-0026](https://github.com/EchoJustus/clofin-core/blob/main/docs/ADR/0026-three-repositories-and-the-cockpits-role-boundary.md)
  draws
- **Supersedes / Superseded by:** — · **Extends:** [ADR-0001](0001-typescript-on-a-tsc-only-toolchain-without-a-framework.md)

## Context

Phase 1 built a page that reads. `tools/guard-network.mjs` refused, among other
things, `<form>`, `<input>`, every browser storage API, and any origin but
`https://api.github.com`. Those refusals cost nothing, because nothing the
increment needed wanted any of them: a list of releases and a block of generated
shell text collect no input and store no state.

Phase 2 is the opposite shape. Its purpose is to **drive a real instance the
operator names**, which requires:

- a field to type an address into, and therefore a form;
- an origin decided at runtime, which a `Content-Security-Policy` written at
  build time cannot name;
- somewhere to keep the addresses between visits, which is storage;
- per-instance synthetic actor ids, which are credentials in the only sense
  that matters — `clofin-core`'s own `clofin.api.principal` says *"anyone who
  can reach the service can claim to be any seeded actor"*.

A guard that refuses all four cannot be satisfied by the increment. A guard
relaxed to permit all four unconditionally would stop being a guard. The
decision is which of those four refusals expired, and what the other three
become.

There is a trap in the framing, and it is worth naming because it is how this
kind of guard usually dies. The tempting move is to widen each rule just enough
for the new feature: allow forms; allow storage; allow `connect-src https:`;
allow a token "for later". Each step is defensible on its own and the end state
is a check that refuses nothing anybody would actually do. `clofin-core`'s
standing lesson **L-6** is the record of that shape — a guard stated over a
partial set, passing because the part it looks at is clean.

## Decision

**One refusal is removed, because its reason expired. Three are replaced by
narrower rules that say more than "never".**

### 1. Forms and inputs are permitted

`<form>` and `<input>` are no longer refused. The reason they were refused —
*nothing legitimate needs one* — stopped being true when the increment's purpose
became driving an API with operator-supplied values.

What replaces the refusal is a policy directive rather than a hope:
`form-action 'none'` remains in the page's `Content-Security-Policy`, so no form
in this repository can submit anywhere. The submit handler calls
`preventDefault`, and the browser would refuse the navigation even if a future
handler forgot to.

### 2. Persistence: confined, not forbidden

The instance registry — **base URLs and labels, and nothing else** — is stored.
That is the whole of what this repository persists, and the guard makes it
checkable rather than promised:

- `localStorage` may appear in exactly one module, `js/registry.js`. Anywhere
  else the build fails.
- The three other browser stores appear **nowhere at all** — the per-session
  one, the indexed database and the cookie jar. Their names are refused
  everywhere, including in comments, which is why this ADR describes them
  rather than naming them.
- `registry.serialise` builds each stored record field by field from a literal.
  There is no spread and no whole-object `JSON.stringify`, so a field added to
  the type later cannot reach storage by accident, and `registry.test.ts`
  passes an entry carrying an actor id and asserts the serialised text does not
  contain it.

### 3. Credentials: still none, and now also checked in the output

No token of any kind is handled — no GitHub token, no field to supply one, and
the `Authorization` header name and the phrase for a personal access token
remain refused everywhere in the built output. The Codespaces driver, which
would introduce one, is deliberately a later phase.

The synthetic actor ids a bootstrap run mints are new, and are treated as
credentials:

- minted in the browser with `crypto.randomUUID()`, held in a module-level map
  for the life of the page, sent only to the origin they were minted for, and
  dropped when the instance is forgotten;
- **and the build refuses to emit any file containing a UUID at all.** That is
  a blunt rule, and blunt is the point: there is no legitimate reason for a
  UUID to be in this repository's output, so "no UUID anywhere" is a rule with
  no exceptions to argue about, and it catches an id written into a file long
  before anybody would think to look.

### 4. Origins: one rule, three enforcements, and it may be narrowed but not widened

`src/origins.ts` holds the permitted **shapes** of instance address — a
loopback port on the operator's own machine, and a GitHub Codespaces forwarded
port. From that one constant, three things are derived:

| Derived | Where |
|---|---|
| The `connect-src` in the page's policy | rendered by `tools/build.mjs` at build time |
| The runtime refusal, with the sentence an operator reads | `decideInstanceUrl` |
| The guard's list of hosts that may appear in the output at all | `tools/guard-network.mjs` |

And **the runtime seam is stricter than the shape**: `net.ts` will contact an
instance origin only if `registry.connect` has put it in the connected set, so
"an address that looks like an instance" is not enough — it has to be one the
operator connected. Forgetting an instance withdraws it in the same call that
drops its credentials.

The guard no longer holds a copy of the policy string. It reads the policy from
the built `js/origins.js` — the same module the runtime uses — and then holds it
to **properties** a widening would violate:

- no `'unsafe-inline'`, no `'unsafe-eval'`;
- no bare `http:` or `https:` scheme source, which is every host there is;
- no bare `*`;
- `default-src 'none'`, `script-src 'self'`, `form-action 'none'`,
  `base-uri 'none'` all present.

So editing `origins.ts` to make something work fails the build if the edit
widens the policy, and passes if it narrows it. That is the answer to the trap
in the Context: the guard cannot be satisfied by editing the file it guards.

### 5. The two checks are extended, not multiplied

`clofin-cockpit` carries exactly two automated checks and is entitled to no
third — ADR-0026's reasoning, unchanged. Both now cover the seed profiles as
well as the pages: `no-unqualified-audited` reads `.json` in the built output,
and `scope-verbatim`'s near-copy rule runs over the profiles too. A profile is a
document this site serves and renders, full of prose about what a step
demonstrates, which is exactly where an unqualified assurance word appears. One
rule, more files.

## Alternatives considered

| Option | Why it was rejected |
|---|---|
| **Keep refusing forms; collect the address from the URL hash** | The page would still take operator input, through a channel with no label, no validation affordance and no accessible control — the refusal would be satisfied in the letter and defeated in fact. A guard that can be satisfied that way teaches contributors to route around it |
| **`connect-src https:` (or `*`), and rely on the runtime check** | The whole value of the policy is that it holds when the code is wrong. A policy that permits every host on the internet is a policy that never fires, and the runtime check it defers to is the thing most likely to have the bug |
| **Rewrite the policy at runtime when an instance connects** | Not possible in the direction wanted: additional policies intersect, so a page can tighten but never widen after load. Attempting it would produce a policy that looks dynamic and is not |
| **Name specific ports in `connect-src`** | The operator chooses the port. A fixed list would refuse the instance somebody actually started, which is the failure the runtime message exists to avoid |
| **Refuse browser storage entirely; retype the address each visit** | Genuinely tempting, and the cost is real but small. Rejected because the registry is the state that makes credentials cleanable: "forget this instance" has to remove something, and an in-memory-only list means every reload silently drops the association between an instance and the ids minted for it |
| **Store the run's actor ids too, so a run survives a reload** | The exact thing this repository must not do. A credential in a browser store outlives the session that needed it, ends up in a backup or a sync, and turns "held for this tab" into a claim nobody can check. A run is a thing you watched happen; losing it on reload is correct |
| **A third check for the new surface** | ADR-0026 gives the reason a repository that owns no truth is entitled to two guarantees and not three. The new surface is covered by extending both existing checks and by the build refusing, which is a stronger enforcement than a check that reports on output already produced |
| **Drop the guard's UUID rule as too blunt** | It would fire on a legitimate UUID one day, and on that day the right answer is to ask why one is in the output. Blunt rules with no exceptions are the ones that survive |

## Consequences

**Positive**

- The rule about what this page may contact exists once and is enforced three
  times from that one place, so the browser's rule and the code's rule cannot
  drift.
- "This repository stores nothing but a list of addresses" is checkable by
  reading one module, and by a test that asserts a credential does not survive
  serialisation.
- The guard now refuses a *policy* that is too wide, not only code that is
  wrong. That is a class of defect no amount of reviewing the diff would catch
  reliably.
- Still two checks.

**Negative / accepted cost**

- The permitted instance shapes are narrower than "any address". An operator
  running an instance on a LAN address or behind their own domain cannot
  connect it, and would have to widen `connect-src` — deliberately, in a diff,
  with this ADR in front of them. That is the intended friction, and it is a
  real limitation rather than a hypothetical one.
- `https://*.app.github.dev` is a wildcard subdomain: it admits any Codespace,
  not only the operator's. It is the shape the platform's URL space has, the
  page will still only contact one the operator connected, and it is stated
  here rather than left to be discovered.
- The guard reads the policy from the built output, so a contributor who edits
  `origins.ts` changes both the page and the comparison. The property checks
  are what makes that safe; without them this would be a check comparing a file
  with itself.
- A future increment that legitimately needs a UUID in a built file will have
  to change the guard, visibly.

**Risks and how they are mitigated**

- *Risk:* a synthetic actor id is written somewhere it outlives the session.
  *Mitigation:* one storage module, a serialiser that builds records field by
  field, a test that smuggles an actor id through it, and a build that refuses
  any output containing a UUID.
- *Risk:* the permitted-origin rule is widened casually to fix a support
  question. *Mitigation:* the policy-property checks fail the build for the
  widenings that matter, and the narrower ones are a diff in a file whose whole
  content is the rule.
- *Risk:* the profiles become a place where prose says more than the code does
  — "this step demonstrates the thresholds are configured" when it does not.
  *Mitigation:* every manual step is required by `profiles.test.ts` to carry a
  non-empty *what this cannot show* list, and both checks read the profiles.
- *Risk:* a form is added that submits somewhere. *Mitigation:*
  `form-action 'none'`, asserted present by the guard's policy properties.

## Verification

- `npm run build` runs the type-check, the unit tests and the guard, and
  **removes `_site`** if the guard objects — there is no site to publish, which
  is the difference between refusing and reporting.
- Negative controls, each run for real and recorded in
  [`012-REQ`](https://github.com/EchoJustus/clofin-core/blob/main/docs/audits/012-REQ-cockpit-connect-and-bootstrap.md):
  a second module naming the browser store; the policy widened to a scheme
  source; a UUID left in a built file; a CDN `<script>` in the page. All four
  fail the build with the reason named.
- `origins.test.ts` asserts the policy's properties independently of the guard,
  and asserts that every source in the policy is an address `decideInstanceUrl`
  accepts and vice versa — so the browser cannot refuse what the page permits.
- `registry.test.ts` asserts what reaches storage, including that an entry
  carrying an actor id serialises without it.
- Driven in Chromium against real running instances: the only origins the page
  contacted were its own, `api.github.com`, and the instances the operator
  connected; `localStorage` held one key containing base URLs and labels;
  session storage and cookies were empty.
