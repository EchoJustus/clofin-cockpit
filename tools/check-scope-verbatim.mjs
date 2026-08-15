#!/usr/bin/env node
/**
 * CHECK 1 of 2 — `scope-verbatim`.
 *
 *     node tools/check-scope-verbatim.mjs [--site _site] [--readme README.md]
 *
 * The scope statement on the built page must be the canonical constant
 * **byte for byte**, and the constant must be the text the README quotes.
 *
 * Not "a disclaimer is present". That check passes on softened wording, and
 * softened wording is the entire failure mode: nobody deletes a disclaimer,
 * they reword it until it stops being inconvenient. `clofin-core`'s standing
 * lesson **L-6** is the record of a guard that looked only at the copy its
 * author was looking at, and `clofin-trace` carries this check's sibling for
 * the same reason. Three rules, and the second is the one with teeth.
 *
 * 1. **Every built page carries a marked scope statement**, and every marked
 *    statement equals the constant exactly. A page with none fails: the
 *    statement is in-frame on every view or it is not doing its job.
 *
 * 2. **Every near-copy in the visible text is a full copy.** Wherever a page's
 *    text contains a distinctive opening of the statement, the whole statement
 *    must continue from exactly there. This is what catches the failure that
 *    matters — not a missing disclaimer, which anyone would notice, but a
 *    second, friendlier one further down the page.
 *
 * 3. **`README.md` carries it too.** The repository's front door is read more
 *    often than the site. Markdown hard-wraps and quotes with `>`, so the
 *    comparison unwraps line breaks and blockquote markers — and nothing else.
 *    A changed word still fails.
 *
 * The constant is read from the **built** `js/scope.js`, so what is compared is
 * the module the browser actually loads rather than a second reading of the
 * source. When a comparison fails the report names the exact character at which
 * the two diverge, because "the disclaimer differs" is not a defect report
 * anyone can act on.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { byAttribute, parse, visibleText } from "./htmlscan.mjs";

/** Enough of an opening to identify a copy; short enough that a reworded tail is caught. */
const OPENINGS = [
  "CloFin operates on synthetic data",
  "It is not connected to any bank",
  "holds no regulatory authorisation",
  "never processes real funds",
];

const SCOPE_MARKER = "data-scope-statement";

function argument(flag, fallback) {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

function describe(character) {
  if (character === undefined) return "end of text";
  const code = character.codePointAt(0).toString(16).padStart(4, "0");
  return `${JSON.stringify(character)} (U+${code.toUpperCase()})`;
}

/** Name the character at which two strings diverge. */
function firstDifference(expected, actual) {
  const limit = Math.min(expected.length, actual.length);
  let index = 0;
  while (index < limit && expected[index] === actual[index]) index += 1;

  return [
    `      first differs at character ${index}:`,
    `        expected ${describe(expected[index])}`,
    `        found    ${describe(actual[index])}`,
    `      canonical: …${JSON.stringify(expected.slice(Math.max(0, index - 30), index + 40))}`,
    `      rendered:  …${JSON.stringify(actual.slice(Math.max(0, index - 30), index + 40))}`,
  ].join("\n");
}

const flatten = (text) => text.replace(/\s+/g, " ").trim();

/** Rule 2, over one body of visible text. */
function checkCopies(where, text, canonical) {
  const problems = [];
  const flat = flatten(text);
  const target = flatten(canonical);

  for (const opening of OPENINGS) {
    let from = 0;
    for (;;) {
      const found = flat.indexOf(opening, from);
      if (found < 0) break;
      from = found + opening.length;

      const begin = found - target.indexOf(opening);
      if (begin < 0 || flat.slice(begin, begin + target.length) !== target) {
        const excerpt = flat.slice(Math.max(0, begin), Math.max(0, begin) + target.length + 20);
        problems.push(
          `${where}: the scope statement appears in a form that is not the canonical one, ` +
            `beginning at ${JSON.stringify(opening)}.\n${firstDifference(target, excerpt)}`,
        );
        break;
      }
    }
  }

  return problems;
}

/** Markdown blockquote as the paragraph it renders to; nothing else normalised. */
function unwrapMarkdown(text) {
  return flatten(text.replace(/^[ \t]*>[ ]?/gm, ""));
}

async function main() {
  const site = resolve(argument("--site", "_site"));
  const readmePath = resolve(argument("--readme", "README.md"));
  const problems = [];

  let canonical;
  try {
    ({ SCOPE_STATEMENT: canonical } = await import(pathToFileURL(join(site, "js", "scope.js")).href));
  } catch (error) {
    process.stderr.write(`scope-verbatim FAILED: cannot read the canonical constant from ${site}/js/scope.js\n  ${error.message}\n`);
    return 1;
  }

  if (typeof canonical !== "string" || canonical.length === 0) {
    process.stderr.write("scope-verbatim FAILED: SCOPE_STATEMENT is not a non-empty string.\n");
    return 1;
  }

  const pages = (await readdir(site, { recursive: true })).filter((name) => name.endsWith(".html")).sort();
  if (pages.length === 0) problems.push(`${site}: no pages were built`);

  let marked = 0;
  for (const name of pages) {
    const tree = parse(await readFile(join(site, name), "utf8"));
    const statements = byAttribute(tree, SCOPE_MARKER);

    if (statements.length === 0) {
      problems.push(
        `${name}: carries no [${SCOPE_MARKER}] element. The statement belongs in-frame on ` +
          "every view, not in a footer on one of them.",
      );
    }

    for (const element of statements) {
      marked += 1;
      const rendered = element.children.map((child) => (typeof child === "string" ? child : "")).join("");
      const text = visibleText(element).trim() || rendered.trim();
      if (text !== canonical) {
        problems.push(
          `${name}: the rendered scope statement is not the canonical one.\n${firstDifference(canonical, text)}`,
        );
      }
    }

    problems.push(...checkCopies(name, visibleText(tree), canonical));
  }

  let readme;
  try {
    readme = await readFile(readmePath, "utf8");
  } catch {
    problems.push(`${readmePath}: not found; the repository's front door must carry the scope statement too`);
  }

  if (readme !== undefined) {
    const unwrapped = unwrapMarkdown(readme);
    if (!unwrapped.includes(flatten(canonical))) {
      problems.push(
        "README.md: does not quote the canonical scope statement verbatim. The constant in " +
          "src/scope.ts and the README's quotation are the same sentence and must stay identical.",
      );
    }
    problems.push(...checkCopies("README.md", unwrapped, canonical));
  }

  if (problems.length > 0) {
    process.stderr.write("scope-verbatim FAILED\n");
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write(`\n${problems.length} problem(s).\n`);
    return 1;
  }

  process.stdout.write(
    `scope-verbatim OK — the canonical scope statement appears verbatim ${marked} time(s) ` +
      `across ${pages.length} page(s), and in README.md.\n`,
  );
  return 0;
}

process.exitCode = await main();
