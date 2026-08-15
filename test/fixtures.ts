/**
 * Recorded inputs for the tests.
 *
 * `REF_1_BODY` is the body of the published `ref-1` release of `clofin-core`,
 * copied character for character from the GitHub Releases API — **including
 * its CRLF line endings**, which is not a detail: GitHub returns `\r\n`, the
 * paragraph splitter has to cope with it, and a fixture normalised to `\n`
 * would test a case that never happens in production.
 *
 * The same text is mirrored in `clofin-core` at
 * `docs/releases/ref-1.annotation.txt`.
 *
 * These are test inputs, not display data. Nothing here is ever rendered: the
 * cockpit shows what the API answers at the moment it is asked.
 */

export const REF_1_BODY: string = [
  "Date:        2026-08-05",
  "Commit:      5c7b4badced5e807e1022fce44cbcad38c6d2095",
  "Candidate:   5d21334c1bfc59aba702e094155eea03dc9b1ef0 (tagged on its",
  "             remediation descendant, as the release rules permit)",
  "",
  "WHAT THIS IS. A tagged, audited snapshot of a reference implementation that",
  "runs on SYNTHETIC DATA ONLY. It is not a production deployment, not an",
  "attestation, not a claim of real institutional connectivity, and nothing here",
  "has handled real funds or connected to any bank, payment scheme or central",
  "bank. The release audit is an internal quality gate.",
  "",
  "RELEASE AUDIT: PARTIAL. Charter items 1-4 of 8 were performed (migrations",
  "replayed from empty; full suite; cross-document consistency; the partial-set",
  "sweep). Items 5-7 were NOT performed - standing-lessons compliance, known-debt",
  "reconciliation, and the synthetic-data/neutrality sweep - because the external",
  "auditor's compute quota was exhausted mid-audit. Closed under the recorded",
  "resource-interruption fallback; the uncovered items carry forward as",
  "mandatory-first scope for ref-2.",
  "",
  "FINDINGS. 19 raised (2 blocking, 17 should-fix), all remediated before this",
  "tag. Four mechanisms are deferred with named targets, their claims narrowed",
  "now so no document holds an unsupported statement.",
  "",
  "CONTENTS. Increments 1-5: double-entry ledger, payment lifecycle and",
  "idempotency, authorisation with maker-checker and an append-only audit trail,",
  "audit coverage across every API write, and settlement simulation. Eleven",
  "forward-only migrations. Controls C-01 through C-06 and C-08 through C-12",
  "enforced; C-07 (screening) designed and not built.",
  "",
  "Records: docs/audits/ on the meta branch - FEEDBACK-M1, FEEDBACK-M2,",
  "FEEDBACK-REL-ref-1, and standing lessons L-1 through L-14.",
].join("\r\n");

/** The commit `ref-1` points at, as the Tags API reports it. */
export const REF_1_SHA = "5c7b4badced5e807e1022fce44cbcad38c6d2095";

/** A minimal Releases API entry, shaped as GitHub returns it. */
export function releaseJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: "ref-1",
    name: "CloFin reference implementation, first tagged release",
    body: REF_1_BODY,
    prerelease: true,
    draft: false,
    published_at: "2026-08-05T10:34:54Z",
    html_url: "https://github.com/EchoJustus/clofin-core/releases/tag/ref-1",
    ...overrides,
  };
}

/** A minimal Tags API entry. */
export function tagJson(name = "ref-1", sha = REF_1_SHA): Record<string, unknown> {
  return { name, commit: { sha } };
}
