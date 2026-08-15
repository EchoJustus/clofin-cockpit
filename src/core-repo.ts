/**
 * Where `clofin-core` is. The cockpit reads this repository and nothing else.
 *
 * These coordinates are the only project the cockpit knows about. It is not a
 * general GitHub browser that happens to be pointed at CloFin — it is the
 * operator surface for one system, and a configurable target would be a way
 * to make it display a repository whose releases carry no audit statement at
 * all, under a frame that says they do.
 */
export const CORE_REPO = {
  owner: "EchoJustus",
  name: "clofin-core",
  /** Used only to generate text you run yourself. Nothing here clones anything. */
  cloneUrl: "https://github.com/EchoJustus/clofin-core.git",
  htmlUrl: "https://github.com/EchoJustus/clofin-core",
} as const;

/** Releases are named `ref-<n>`. Anything else is not a CloFin reference release. */
export const RELEASE_TAG_PATTERN = /^ref-(\d+)$/;
