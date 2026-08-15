/**
 * The build's refusal: what the site is not allowed to be.
 *
 * This is not one of the repository's two checks. It runs *inside* the build,
 * and when it finds something the build fails and there is no `_site` to
 * publish. That distinction is deliberate. The two checks — `scope-verbatim`
 * and `no-unqualified-audited` — are guarantees this repository makes about
 * what it *says*. This guard is about what the built page can *do*, and the
 * honest way to enforce "the site cannot reach anywhere else" is to be unable
 * to produce a site that does, rather than to produce one and then report on
 * it.
 *
 * What it refuses:
 *
 * - Any `fetch(` outside `js/net.js`. One network seam, not several.
 * - A missing, altered or widened `Content-Security-Policy`. The policy is
 *   what makes the browser enforce the same rule at runtime.
 * - Any subresource — script, stylesheet, image, frame — from another origin.
 *   No CDN, no web font, no analytics beacon, no error reporter.
 * - Any `<form>`, any credential handling, any storage API. This increment
 *   holds no token, so there is nothing to put anywhere, and the absence is
 *   checked rather than asserted.
 * - Any absolute URL to a host outside the small allowlist below.
 *
 * The allowlist distinguishes two things that a naive scan conflates: an
 * origin the page *contacts by itself*, and an address that merely appears in
 * text. `api.github.com` is the first. `github.com` is the second — it appears
 * in links the reader may click and in the `git clone` line of a deployment
 * card, and a hyperlink a person follows is a navigation they chose, not a
 * request this page made. The Content-Security-Policy is what keeps that
 * distinction true at runtime: `connect-src` names one host, so nothing else
 * can become a request no matter where its text appears.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

import { byAttribute, elements, parse } from "./htmlscan.mjs";

/** The exact policy the page must carry. Byte for byte — a widened one is a changed one. */
export const REQUIRED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; " +
  "connect-src https://api.github.com; img-src 'self' data:; " +
  "base-uri 'none'; form-action 'none'";

/** The only origin the page may contact. */
const CONNECT_ORIGIN = "https://api.github.com";

/** The only module allowed to call `fetch`. */
const NETWORK_MODULE = "js/net.js";

const ALLOWED_HOSTS = new Map([
  ["api.github.com", "the one origin this page contacts"],
  ["github.com", "appears in hyperlinks and in generated git commands; never fetched"],
  [
    "www.w3.org",
    "appears only as the SVG namespace identifier in the inline favicon; namespaces are names, not addresses, and default-src 'none' would block a request to it anyway",
  ],
]);

/** APIs whose presence would contradict something this repository claims. */
const FORBIDDEN_PATTERNS = [
  [/\bXMLHttpRequest\b/, "XMLHttpRequest — the one network seam is js/net.js"],
  [/\bnew\s+WebSocket\b/, "WebSocket"],
  [/\bnew\s+EventSource\b/, "EventSource"],
  [/\bsendBeacon\s*\(/, "navigator.sendBeacon — telemetry"],
  [/\bimportScripts\s*\(/, "importScripts"],
  [/\bserviceWorker\b/, "service worker registration"],
  [/\blocalStorage\b/, "localStorage — this repository stores nothing"],
  [/\bsessionStorage\b/, "sessionStorage — this repository stores nothing"],
  [/\bindexedDB\b/, "IndexedDB — this repository stores nothing"],
  [/document\s*\.\s*cookie/, "document.cookie — this repository stores nothing"],
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\s*\(/, "new Function"],
  // Case-sensitive and spelled with a `z` on purpose: that is the HTTP header,
  // while this project's prose — including the scope statement's "regulatory
  // authorisation" — spells the ordinary word with an `s`. The pattern catches
  // the header without ever firing on English.
  [/\bAuthorization\b/, "an Authorization header — no credential is handled in this increment"],
  [/\bBearer\s+\$?\{?[A-Za-z_]/, "a Bearer token"],
  [/\bpersonal[- ]access[- ]token\b/i, "a personal access token"],
  [/<input\b/i, "an <input> element — nothing here collects input"],
  [/<form\b/i, "a <form> element — nothing here submits anything"],
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

    // 2. Nothing that contradicts "no telemetry, no storage, no credentials".
    for (const [pattern, description] of FORBIDDEN_PATTERNS) {
      if (pattern.test(file.text)) problems.push(`${file.name}: contains ${description}.`);
    }

    // 3. No absolute URL to an unexpected host, anywhere.
    for (const match of file.text.matchAll(/https?:\/\/([A-Za-z0-9._-]+)/g)) {
      const host = match[1].toLowerCase();
      if (!ALLOWED_HOSTS.has(host)) {
        problems.push(
          `${file.name}: refers to ${host}, which is not an allowed host. ` +
            `Allowed: ${[...ALLOWED_HOSTS.keys()].join(", ")}.`,
        );
      }
    }
  }

  // 4. Every page carries the exact policy, and loads nothing from elsewhere.
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
    } else {
      const policy = (policies[0].attributes["content"] ?? "").replace(/\s+/g, " ").trim();
      if (policy !== REQUIRED_CSP) {
        problems.push(
          `${page.name}: the Content-Security-Policy is not the required one.\n` +
            `      required: ${REQUIRED_CSP}\n` +
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

  // 5. Stylesheets pull nothing in either.
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
