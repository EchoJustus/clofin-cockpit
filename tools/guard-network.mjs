/**
 * The build's refusal: what the site is not allowed to be.
 *
 * This is not one of the repository's two checks. It runs *inside* the build,
 * and when it finds something the build fails and there is no `_site` to
 * publish. That distinction is deliberate. The two checks — `scope-verbatim`
 * and `no-unqualified-audited` — are guarantees this repository makes about
 * what it *says*. This guard is about what the built page can *do*, and the
 * honest way to enforce a rule of that shape is to be unable to produce a site
 * that breaks it, rather than to produce one and then report on it.
 *
 * ## What changed in phase 2, and what deliberately did not
 *
 * Phase 1 refused `<form>` and `<input>` outright, because nothing legitimate
 * needed one and their absence was therefore free. Phase 2's whole purpose is
 * forms that drive a real API — an address to connect to, a profile to run —
 * so that refusal is gone. It is the only thing that is gone, and it was
 * removed because the reason for it expired, not because it became
 * inconvenient. `docs/ADR/0002` records the reasoning.
 *
 * Everything else got **stricter or wider in scope**, never looser:
 *
 * - `fetch` is still confined to one module.
 * - The `Content-Security-Policy` is no longer a constant here at all: it is
 *   read from the built `js/origins.js`, which is the same module the runtime
 *   check uses, and then held to a list of **properties** — no `'unsafe-inline'`,
 *   no bare `https:` or `http:` scheme source, no `*`, `default-src 'none'`,
 *   `form-action 'none'`. Widening the rule in `origins.ts` therefore fails the
 *   build rather than quietly changing what the page may reach.
 * - Persistence is no longer forbidden outright, because the instance registry
 *   exists. It is confined instead: `localStorage` may appear in exactly one
 *   module, and `sessionStorage`, IndexedDB and the cookie API appear nowhere
 *   at all. "Stores nothing" became "stores one list of addresses, in one
 *   file", which is a checkable sentence rather than a weaker one.
 * - Telemetry, off-origin subresources, `eval`, service workers and every
 *   credential pattern are refused exactly as before.
 *
 * ## Hosts in text versus hosts contacted
 *
 * The allowlist distinguishes two things a naive scan conflates: an origin the
 * page *contacts by itself*, and an address that merely appears in text.
 * `api.github.com` is the first. `github.com` is the second — it appears in
 * links the reader may click and in the `git clone` line of a deployment card,
 * and a hyperlink a person follows is a navigation they chose, not a request
 * this page made. The loopback hosts come from the origin rules themselves, so
 * the guard's idea of what may appear and the policy's idea of what may be
 * contacted have one source.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { byAttribute, elements, parse } from "./htmlscan.mjs";

/** The only origin the page contacts on its own initiative, without being asked. */
const CONNECT_ORIGIN = "https://api.github.com";

/** The only module allowed to call `fetch`. */
const NETWORK_MODULE = "js/net.js";

/**
 * The only module allowed to name a browser storage API.
 *
 * One file, so "what does this repository persist?" is answered by reading one
 * file rather than by trusting a claim.
 */
const STORAGE_MODULE = "js/registry.js";

/**
 * Properties the policy must have, whatever `origins.ts` says.
 *
 * This is the half of the check that a contributor editing `origins.ts` cannot
 * satisfy by editing `origins.ts`. Each entry is a thing that must not be true
 * of the rendered policy.
 */
const POLICY_MUST_NOT = [
  [/'unsafe-inline'/, "'unsafe-inline' — inline script or style would defeat script-src 'self'"],
  [/'unsafe-eval'/, "'unsafe-eval'"],
  [/(^|[;\s])https?:([;\s]|$)/, "a bare http: or https: scheme source, which is every host there is"],
  [/(^|[;\s])\*([;\s]|$)/, "a bare * source"],
  [/data:\s*(?=[^;]*script-src)/, "a data: source inside script-src"],
];

const POLICY_MUST = [
  [/(^|;\s*)default-src 'none'(;|$)/, "default-src 'none'"],
  [/(^|;\s*)script-src 'self'(;|$)/, "script-src 'self'"],
  [/(^|;\s*)form-action 'none'(;|$)/, "form-action 'none'"],
  [/(^|;\s*)base-uri 'none'(;|$)/, "base-uri 'none'"],
];

/** APIs whose presence would contradict something this repository claims. */
const FORBIDDEN_PATTERNS = [
  [/\bXMLHttpRequest\b/, "XMLHttpRequest — the one network seam is js/net.js"],
  [/\bnew\s+WebSocket\b/, "WebSocket"],
  [/\bnew\s+EventSource\b/, "EventSource"],
  [/\bsendBeacon\s*\(/, "navigator.sendBeacon — telemetry"],
  [/\bimportScripts\s*\(/, "importScripts"],
  [/\bserviceWorker\b/, "service worker registration"],
  [/\bsessionStorage\b/, "sessionStorage — the registry is the only thing this repository stores"],
  [/\bindexedDB\b/, "IndexedDB — the registry is the only thing this repository stores"],
  [/\bcookieStore\b/, "the cookie store — the registry is the only thing this repository stores"],
  [/document\s*\.\s*cookie/, "document.cookie — the registry is the only thing this repository stores"],
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\s*\(/, "new Function"],
  // Case-sensitive and spelled with a `z` on purpose: that is the HTTP header,
  // while this project's prose — including the scope statement's "regulatory
  // authorisation" — spells the ordinary word with an `s`. The pattern catches
  // the header without ever firing on English.
  [/\bAuthorization\b/, "an Authorization header — no credential of that kind is handled here"],
  [/\bBearer\s+\$?\{?[A-Za-z_]/, "a Bearer token"],
  [/\bpersonal[- ]access[- ]token\b/i, "a personal access token"],
  // A minted actor id is a credential and is held in memory. A 36-character
  // UUID appearing in the *built output* would mean one had been written into
  // a file, which is the one thing that must never happen to them.
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    "a UUID — the synthetic actor ids a bootstrap run mints live in memory for a session and " +
      "must never appear in a built file",
  ],
];

/**
 * The only module allowed to turn a response into a figure.
 *
 * Phase 3 puts balances on the screen, which is the point at which "the cockpit
 * computes no figure" stops being a sentence in a README and starts needing an
 * enforcement. `js/figures.js` reads a value out of a response body at a path
 * and re-serialises it; it contains no arithmetic, and the rules below are what
 * keep that true of the whole built site.
 */
const FIGURES_MODULE = "js/figures.js";

/**
 * Identifiers that name money, and must never stand next to an arithmetic
 * operator anywhere in the output.
 *
 * `minorUnits + minorUnits` is the defect this exists to catch, and so is
 * `minorUnits / 100` — the innocent-looking one that turns 375000 into a
 * prettier 3750.00 that nobody sent. The rule is blunt in the shape ADR-0002
 * chose for the UUID rule: there is no legitimate reason for this repository to
 * do arithmetic on a money value, so "never" has no exceptions to argue about,
 * and a future increment that needs one will have to change this file visibly.
 */
const MONEY_IDENTIFIERS = ["minorUnits", "closingBalance", "openingBalance", "amountMinor"];

/**
 * Number formatters, refused everywhere including inside the figures module.
 *
 * A formatter is arithmetic wearing a presentation hat: `toFixed(2)` on minor
 * units is a division, and `Intl.NumberFormat` additionally decides a thousands
 * separator and a currency symbol on the reader's behalf. This page prints what
 * the instance sent.
 */
const FORMATTER_PATTERNS = [
  [/\btoFixed\s*\(/, "toFixed — formatting a number is arithmetic this page does not do"],
  [/\btoLocaleString\s*\(/, "toLocaleString — the same, with a locale's opinion added"],
  [/\bIntl\s*\.\s*NumberFormat\b/, "Intl.NumberFormat"],
  [/\bparseFloat\s*\(/, "parseFloat — money is never a float, here least of all"],
];

/** Subresource attributes: things the browser loads without being asked twice. */
const SUBRESOURCE_ATTRIBUTES = {
  script: "src",
  link: "href",
  img: "src",
  iframe: "src",
  source: "src",
  embed: "src",
  object: "data",
  video: "src",
  audio: "src",
  track: "src",
};

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

function isLocalReference(value) {
  const reference = value.trim();
  if (reference === "") return true;
  if (reference.startsWith("#")) return true;
  if (reference.startsWith("data:")) return true;
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference) && !reference.startsWith("//");
}

/**
 * Inspect a built site.
 *
 * @param {string} siteDir
 * @returns {Promise<string[]>} problems; empty means the site may be published.
 */
export async function guardNetwork(siteDir) {
  const problems = [];
  const files = [];

  // The policy and the host allowlist are read from the built application, so
  // there is one statement of the rule rather than a copy here to fall behind.
  let requiredPolicy = null;
  const allowedHosts = new Map([
    ["api.github.com", "the one origin this page contacts on its own initiative"],
    ["github.com", "appears in hyperlinks and in generated git commands; never fetched"],
    [
      "www.w3.org",
      "appears only as the SVG namespace identifier in the inline favicon; namespaces are names, not addresses, and default-src 'none' would block a request to it anyway",
    ],
  ]);

  try {
    const origins = await import(pathToFileURL(join(siteDir, "js", "origins.js")).href);
    requiredPolicy = origins.contentSecurityPolicy();
    for (const rule of origins.ORIGIN_RULES) {
      for (const source of rule.cspSources) {
        const host = /^https?:\/\/([A-Za-z0-9._-]+)/.exec(source)?.[1];
        if (host) allowedHosts.set(host.toLowerCase(), `an instance address: ${rule.label}`);
      }
    }
  } catch (error) {
    problems.push(
      `${siteDir}/js/origins.js could not be read, so the policy this page must carry is ` +
        `unknown: ${error.message}`,
    );
  }

  if (requiredPolicy !== null) {
    for (const [pattern, description] of POLICY_MUST_NOT) {
      if (pattern.test(requiredPolicy)) {
        problems.push(
          `src/origins.ts produces a Content-Security-Policy containing ${description}. ` +
            "The policy may be narrowed but not widened; see docs/ADR/0002.",
        );
      }
    }
    for (const [pattern, description] of POLICY_MUST) {
      if (!pattern.test(requiredPolicy)) {
        problems.push(
          `src/origins.ts produces a Content-Security-Policy without ${description}.`,
        );
      }
    }
  }

  for await (const path of walk(siteDir)) {
    files.push({
      path,
      name: relative(siteDir, path).split(sep).join(posix.sep),
      text: await readFile(path, "utf8"),
    });
  }

  if (files.length === 0) {
    return [`${siteDir}: nothing was built`];
  }

  const pages = files.filter((file) => file.name.endsWith(".html"));
  if (pages.length === 0) problems.push(`${siteDir}: no HTML page was built`);

  for (const file of files) {
    // 1. One network seam.
    if (/\bfetch\s*\(/.test(file.text) && file.name !== NETWORK_MODULE) {
      problems.push(
        `${file.name}: calls fetch(). Every request goes through ${NETWORK_MODULE}, ` +
          "which refuses any origin but " + CONNECT_ORIGIN + ".",
      );
    }

    // 2. One storage seam, and it is the registry.
    if (/\blocalStorage\b/.test(file.text) && file.name !== STORAGE_MODULE) {
      problems.push(
        `${file.name}: names localStorage. The instance registry is the only thing this ` +
          `repository persists, and ${STORAGE_MODULE} is the only module that may write it.`,
      );
    }

    // 3. Nothing that contradicts "no telemetry, no credentials, nothing else stored".
    for (const [pattern, description] of FORBIDDEN_PATTERNS) {
      if (pattern.test(file.text)) problems.push(`${file.name}: contains ${description}.`);
    }

    // 3a. Nothing that contradicts "the cockpit computes no figure".
    for (const [pattern, description] of FORMATTER_PATTERNS) {
      if (pattern.test(file.text)) problems.push(`${file.name}: contains ${description}.`);
    }
    for (const identifier of MONEY_IDENTIFIERS) {
      // Either side of the operator, because `total = a + minorUnits` and
      // `minorUnits / 100` are the same defect written two ways. The colon of
      // a JSON member is deliberately not an operator, so a profile document
      // declaring `"minorUnits": 50000` is untouched — a number the profile
      // *sends* is not a figure this page derived.
      const adjacency = new RegExp(
        `\\b${identifier}\\b\\s*[-+*/%]|[-+*/%]\\s*\\b${identifier}\\b`,
      );
      if (adjacency.test(file.text)) {
        problems.push(
          `${file.name}: performs arithmetic on ${identifier}. Every figure on screen is a ` +
            `value the instance sent, projected by ${FIGURES_MODULE}; see docs/ADR/0003.`,
        );
      }
    }

    // 4. No absolute URL to an unexpected host, anywhere.
    for (const match of file.text.matchAll(/https?:\/\/([A-Za-z0-9._-]+)/g)) {
      const host = match[1].toLowerCase();
      if (!allowedHosts.has(host)) {
        problems.push(
          `${file.name}: refers to ${host}, which is not an allowed host. ` +
            `Allowed: ${[...allowedHosts.keys()].join(", ")}.`,
        );
      }
    }
  }

  // 4a. The figures module has to be in the output at all.
  //
  // This guard deliberately stops there. What the module *does* — that the text
  // of a figure is the response's own value and not a derivation of it — is not
  // something a regular expression over a file can establish, and a check that
  // pretended to would be the shape standing lesson L-6 records: a rule stated
  // over a part of the problem, passing because the part it looks at is clean.
  // An earlier draft of this guard asserted that the module still mentioned the
  // serialiser, and it was satisfied by a *comment* mentioning it — which is
  // precisely the failure, found by running the negative control rather than by
  // reading the rule.
  //
  // The property itself is asserted by `figures.test.ts`, which reads a figure
  // out of a recorded response body and requires its text to appear verbatim in
  // that body. `npm run build` runs the tests before it builds, so a module that
  // started deriving rather than projecting stops the build there — earlier than
  // here, and with a better message.
  if (!files.some((file) => file.name === FIGURES_MODULE)) {
    problems.push(
      `${FIGURES_MODULE} is not in the built output. It is the only path by which a figure ` +
        "reaches the screen, so a site without it is a site whose figures came from somewhere " +
        "neither this guard nor figures.test.ts has checked.",
    );
  }

  // 5. Every page carries the exact policy, and loads nothing from elsewhere.
  for (const page of pages) {
    const tree = parse(page.text);

    const policies = [...elements(tree)].filter(
      (element) =>
        element.tag === "meta" &&
        (element.attributes["http-equiv"] ?? "").toLowerCase() === "content-security-policy",
    );

    if (policies.length !== 1) {
      problems.push(
        `${page.name}: carries ${policies.length} Content-Security-Policy meta tags; exactly one is required.`,
      );
    } else if (requiredPolicy !== null) {
      const policy = (policies[0].attributes["content"] ?? "").replace(/\s+/g, " ").trim();
      if (policy !== requiredPolicy) {
        problems.push(
          `${page.name}: the Content-Security-Policy is not the one src/origins.ts produces.\n` +
            `      required: ${requiredPolicy}\n` +
            `      found:    ${policy}`,
        );
      }
    }

    for (const element of elements(tree)) {
      const attribute = SUBRESOURCE_ATTRIBUTES[element.tag];
      if (!attribute) continue;
      const value = element.attributes[attribute];
      if (value === undefined) continue;
      if (!isLocalReference(value)) {
        problems.push(
          `${page.name}: <${element.tag} ${attribute}="${value}"> loads a subresource from ` +
            "another origin. Everything this page loads is its own.",
        );
      }
    }
  }

  // 6. Stylesheets pull nothing in either.
  for (const sheet of files.filter((file) => file.name.endsWith(".css"))) {
    if (/@import/.test(sheet.text)) {
      problems.push(`${sheet.name}: uses @import, which loads a second stylesheet.`);
    }
    for (const match of sheet.text.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
      if (!isLocalReference(match[1])) {
        problems.push(`${sheet.name}: url(${match[1]}) refers to another origin.`);
      }
    }
  }

  return problems;
}
