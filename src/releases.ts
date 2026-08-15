/**
 * `clofin-core`'s `ref-<n>` releases, read from the public GitHub API.
 *
 * Two endpoints are needed, and the reason is worth stating because getting it
 * wrong would put a wrong commit on screen under a frame that promises
 * provenance. The Releases API does **not** return the commit a tag points at.
 * It returns `target_commitish`, which is the branch or commitish the release
 * was *created from* — usually the string `"main"`, which is not a commit and
 * moves. The tag's actual commit comes from the Tags API, which reports the
 * dereferenced SHA. So the cockpit reads both and joins them by tag name.
 *
 * When that join fails — a release whose tag the Tags API does not list — the
 * SHA is `null` and the interface says *"commit SHA not found"* in the same
 * breath as the tag. It does not fall back to `target_commitish`, which would
 * be a plausible-looking wrong answer, and it does not quietly omit the SHA,
 * which would break the rule that tag, SHA and coverage are always shown
 * together.
 */

import { CORE_REPO, RELEASE_TAG_PATTERN } from "./core-repo.js";
import { parseCoverage, type Coverage } from "./coverage.js";
import { ALLOWED_ORIGIN, getJson } from "./net.js";

/** A release as GitHub describes it, narrowed to what the cockpit displays. */
export interface Release {
  readonly tag: string;
  readonly name: string;
  readonly body: string;
  readonly prerelease: boolean;
  readonly publishedAt: string | null;
  readonly htmlUrl: string;
}

/**
 * A release with everything the honesty frame needs, resolved together.
 *
 * The three fields the frame must never separate — tag, commit, coverage —
 * are assembled here, in one place, so no view can construct a partial one.
 */
export interface ReleaseRecord {
  readonly release: Release;
  /** The tag's dereferenced commit SHA, or `null` if the tag did not resolve. */
  readonly sha: string | null;
  readonly coverage: Coverage;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Map one API release object, or `null` if it is not a usable release. */
function toRelease(value: unknown): Release | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const tag = asString(raw["tag_name"]);
  if (!RELEASE_TAG_PATTERN.test(tag)) return null;

  // A draft is not published. Reading one would mean showing a release that
  // does not exist to anyone else.
  if (raw["draft"] === true) return null;

  return {
    tag,
    name: asString(raw["name"], tag),
    body: asString(raw["body"]),
    // Anything that is not literally `false` is treated as a pre-release. A
    // missing flag must not read as "generally available".
    prerelease: raw["prerelease"] !== false,
    publishedAt: typeof raw["published_at"] === "string" ? raw["published_at"] : null,
    htmlUrl: asString(raw["html_url"], `${CORE_REPO.htmlUrl}/releases/tag/${tag}`),
  };
}

/** Map the Tags API response to tag name → dereferenced commit SHA. */
function toShaByTag(value: unknown): Map<string, string> {
  const shas = new Map<string, string>();
  if (!Array.isArray(value)) return shas;

  for (const entry of value) {
    const raw = asRecord(entry);
    if (!raw) continue;
    const name = asString(raw["name"]);
    const sha = asString(asRecord(raw["commit"])?.["sha"]);
    // A truncated or malformed SHA is not a provenance stamp.
    if (name && /^[0-9a-f]{40}$/.test(sha)) shas.set(name, sha);
  }

  return shas;
}

/** Newest release first, by the number in `ref-<n>`. */
function byDescendingRefNumber(a: Release, b: Release): number {
  const left = Number.parseInt(RELEASE_TAG_PATTERN.exec(a.tag)?.[1] ?? "0", 10);
  const right = Number.parseInt(RELEASE_TAG_PATTERN.exec(b.tag)?.[1] ?? "0", 10);
  return right - left;
}

/**
 * Assemble release records from the two raw API responses.
 *
 * Separated from {@link fetchReleaseRecords} so the whole mapping — including
 * the tag/SHA join and the coverage parse — is testable without a network.
 */
export function buildReleaseRecords(
  rawReleases: unknown,
  rawTags: unknown,
): readonly ReleaseRecord[] {
  const shaByTag = toShaByTag(rawTags);
  const releases = Array.isArray(rawReleases)
    ? rawReleases.map(toRelease).filter((release): release is Release => release !== null)
    : [];

  return releases.sort(byDescendingRefNumber).map((release) => ({
    release,
    sha: shaByTag.get(release.tag) ?? null,
    coverage: parseCoverage(release.body),
  }));
}

const RELEASES_URL = `${ALLOWED_ORIGIN}/repos/${CORE_REPO.owner}/${CORE_REPO.name}/releases?per_page=100`;
const TAGS_URL = `${ALLOWED_ORIGIN}/repos/${CORE_REPO.owner}/${CORE_REPO.name}/tags?per_page=100`;

/** Read every published `ref-<n>` release, newest first. */
export async function fetchReleaseRecords(): Promise<readonly ReleaseRecord[]> {
  const [rawReleases, rawTags] = await Promise.all([getJson(RELEASES_URL), getJson(TAGS_URL)]);
  return buildReleaseRecords(rawReleases, rawTags);
}

/** A short SHA for display. The full one is always shown beside it. */
export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "unknown";
}
