/**
 * Tag, commit and coverage — the three things that are never shown apart.
 *
 * ADR-0020's mitigation for a stale fixture was that "the displayed commit
 * makes the snapshot's age checkable, and the tag's recorded release-audit
 * coverage is displayed beside it rather than implied". The cockpit inherits
 * that rule and tightens it: a release in context shows its **tag, its commit
 * SHA and its release-audit coverage together, or the page has a bug**.
 *
 * The rule is enforced by shape rather than by discipline. This module's one
 * function returns a **fixed three-element tuple**, so there is no code path
 * that produces a tag without a coverage statement beside it — not a
 * convention a future contributor has to know about, but a type that will not
 * compile otherwise. The renderer maps over the tuple and cannot drop an
 * element; a view that wanted only the tag would have to stop calling this
 * function, which is a visible change rather than a quiet one.
 *
 * Every field also has a value for every input. An unresolved commit reads
 * "commit SHA not found" and an unreadable coverage paragraph reads "coverage
 * statement not found" — never an empty string, which on screen is
 * indistinguishable from "nothing to declare".
 */

import { formatCoverage } from "./coverage.js";
import type { ReleaseRecord } from "./releases.js";

export interface ProvenanceField {
  readonly label: string;
  readonly value: string;
  /** A short marker shown beside the value, such as `pre-release`. */
  readonly qualifier: string | null;
  /** Whether the value is an identifier that should be shown in a monospace face. */
  readonly mono: boolean;
}

/** Exactly three fields, in this order, always. */
export type ProvenanceTriple = readonly [ProvenanceField, ProvenanceField, ProvenanceField];

/** Shown in place of a SHA that the Tags API did not resolve. */
export const SHA_NOT_FOUND_LABEL = "commit SHA not found";

export const PROVENANCE_LABELS = {
  tag: "Tag",
  commit: "Commit",
  coverage: "Release-audit coverage",
} as const;

/**
 * The provenance of a release, as three fields that are rendered together.
 *
 * @see ProvenanceTriple — the tuple type is the enforcement.
 */
export function provenanceFields(record: ReleaseRecord): ProvenanceTriple {
  return [
    {
      label: PROVENANCE_LABELS.tag,
      value: record.release.tag,
      qualifier: record.release.prerelease ? "pre-release" : null,
      mono: true,
    },
    {
      label: PROVENANCE_LABELS.commit,
      value: record.sha ?? SHA_NOT_FOUND_LABEL,
      qualifier: null,
      mono: true,
    },
    {
      label: PROVENANCE_LABELS.coverage,
      value: formatCoverage(record.coverage),
      qualifier: null,
      mono: false,
    },
  ];
}
