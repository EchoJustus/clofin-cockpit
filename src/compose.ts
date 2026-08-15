/**
 * The Docker Compose deployment card — generated text, and nothing else.
 *
 * This module writes out the exact commands an operator runs to bring up a
 * reference instance of a tagged release on their own machine. **It runs
 * nothing.** The cockpit has no server, no runner and no shell; there is no
 * code path from this file to anything being executed, and there is not meant
 * to be one. What the operator gets is text they can read before they run it,
 * which is the honest shape for a "deploy" button in a page that owns no
 * truth.
 *
 * **Pinned to the tag and to the commit.** The card checks out the tag,
 * because that is the thing a person asks for by name — and then verifies the
 * commit, because a tag is a movable label and the commit is not. If the two
 * ever disagree, the generated script stops at the `test` line rather than
 * building something other than what the cockpit displayed.
 *
 * **No card for an untagged ref.** There is deliberately no "deploy from
 * `main`" variant. `main` has no release audit, no coverage statement and no
 * stable identity, and the first deployment surface this project ships should
 * not teach the habit of running one. When a real need for it is stated it
 * can be revisited on its own terms — with its own decision about what the
 * frame says while it is on screen.
 */

import { CORE_REPO } from "./core-repo.js";
import type { ReleaseRecord } from "./releases.js";

/** One copyable block: a heading, an optional note, and the lines to run. */
export interface ComposeBlock {
  readonly title: string;
  readonly note: string | null;
  readonly commands: readonly string[];
}

export interface ComposeCard {
  readonly kind: "card";
  readonly tag: string;
  readonly sha: string;
  readonly blocks: readonly ComposeBlock[];
}

/** No card could be generated. Carries why, because a blank card explains nothing. */
export interface ComposeRefusal {
  readonly kind: "refused";
  readonly reason: string;
}

export type ComposeResult = ComposeCard | ComposeRefusal;

/**
 * Build the deployment card for a release.
 *
 * Refuses when the tag's commit is unknown: the card's entire claim is that it
 * is pinned, and a card that silently dropped the verification step would be
 * a card that is not.
 */
export function composeCard(record: ReleaseRecord): ComposeResult {
  const { release, sha } = record;

  if (!sha) {
    return {
      kind: "refused",
      reason:
        `The commit for ${release.tag} could not be read from the GitHub Tags API, ` +
        "so these commands cannot be pinned to it. The cockpit will not generate " +
        "a deployment card it cannot pin.",
    };
  }

  return {
    kind: "card",
    tag: release.tag,
    sha,
    blocks: [
      {
        title: `Fetch ${release.tag} and start it`,
        note:
          "The fourth line verifies that the tag still points at the commit shown " +
          "above; if it does not, the script stops there rather than building " +
          "something else.",
        commands: [
          `git clone ${CORE_REPO.cloneUrl} &&`,
          `cd ${CORE_REPO.name} &&`,
          `git checkout ${release.tag} &&`,
          `test "$(git rev-parse HEAD)" = "${sha}" &&`,
          "make up",
        ],
      },
      {
        title: "Check that it answers",
        note:
          "make up returns as soon as the containers are starting, so give the " +
          "service a few seconds first. make health prints the liveness response; " +
          "make ready additionally reports that the database is reachable.",
        commands: ["make health"],
      },
      {
        title: "Stop it again",
        note: "Keeps the data volumes. make clean removes build caches.",
        commands: ["make down"],
      },
    ],
  };
}

/** The whole card as one block of shell text, for a single copy action. */
export function composeScript(card: ComposeCard): string {
  const header = [
    `# CloFin reference instance — ${card.tag}`,
    `# Commit ${card.sha}`,
    "# Synthetic data only. Not connected to any bank, payment scheme or central bank.",
  ];

  const body = card.blocks.flatMap((block) => ["", `# ${block.title}`, ...block.commands]);

  return [...header, ...body].join("\n");
}
