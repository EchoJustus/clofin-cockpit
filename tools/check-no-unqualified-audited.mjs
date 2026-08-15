#!/usr/bin/env node
/**
 * CHECK 2 of 2 — `no-unqualified-audited`.
 *
 *     node tools/check-no-unqualified-audited.mjs [--site _site]
 *
 * No text in the built output may describe a release as **audited**,
 * **verified** or **reviewed** without a coverage qualifier beside it — in the
 * same sentence, or in the provenance block the sentence sits in.
 *
 * This is `clofin-core`'s AC-11 rule, in a third repository, with the same
 * enforcement. It exists because of what `ref-1` actually is: a release whose
 * audit covered **charter items 1-4 of 8**, the other four having been left
 * undone when the auditor's compute quota ran out. "`ref-1` is audited" is a
 * true-sounding sentence about that release and a misleading one, and it is
 * the sentence a person writes without deciding to mislead anybody. Standing
 * lesson **L-14** is the record of that class of claim; the remedy is that the
 * qualifier travels with the word, always, or the build goes red.
 *
 * **Scope: everything in the built site.** HTML, JavaScript, CSS **and the
 * seed profiles**, including comments — the deployed JavaScript keeps its
 * comments (see `docs/ADR/0001`), so they are part of what a reader of this
 * site can read, and they are held to the same rule as the rendered page.
 * Prose is reassembled across the line wraps and comment leaders it was
 * written with, so a sentence is judged whole rather than in the fragments a
 * text editor happened to leave it in.
 *
 * The profiles joined that list when they arrived, rather than a third check
 * being added for them. They are documents this site serves and renders, they
 * are full of prose about what a step demonstrates, and prose about what
 * something demonstrates is exactly where this word appears without its
 * qualifier. One rule, more files.
 *
 * A failure quotes the offending sentence. A rule whose report says only that
 * something is wrong somewhere is a rule that gets suppressed.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { byAttribute, decodeEntities, parse, visibleText } from "./htmlscan.mjs";

/** The words that make a claim about assurance. */
const CLAIM = /\b(audited|verified|reviewed)\b/i;

/**
 * What counts as saying how much was covered.
 *
 * The coverage levels are matched case-sensitively: `PARTIAL` is the status
 * `clofin-core` publishes, while "a partial view of the ledger" is ordinary
 * English and should not silently qualify an assurance claim.
 */
const QUALIFIERS = [
  /\bcoverage\b/i,
  /\bcharter items?\b/i,
  /\b(FULL|PARTIAL|NONE)\b/,
  /\bnot found\b/i,
  /\bnot stated\b/i,
  /\bitems?\s+\d+\s*[-‐-―]\s*\d+\s+of\s+\d+/i,
];

const SCANNED_EXTENSIONS = [".html", ".js", ".css", ".json"];

function argument(flag, fallback) {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

function isQualified(sentence) {
  return QUALIFIERS.some((pattern) => pattern.test(sentence));
}

/**
 * Reduce a file to prose.
 *
 * Markup, comment delimiters and comment leaders are formatting; the sentences
 * inside them are the thing being checked.
 */
function proseOf(name, raw) {
  if (name.endsWith(".html")) {
    return decodeEntities(raw.replace(/<!--|-->/g, " ").replace(/<[^>]*>/g, " "));
  }
  if (name.endsWith(".css")) {
    return raw.replace(/\/\*|\*\//g, " ");
  }
  if (name.endsWith(".json")) {
    // A profile is prose inside JSON string values. Unescaping the newlines it
    // was written with is what lets a sentence be judged whole rather than
    // split at whatever column the document's author wrapped it.
    return raw.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return raw;
}

/**
 * Split prose into sentences, having first undone the line wrapping.
 *
 * A JSDoc paragraph arrives as several lines each beginning `*`; a sentence
 * split on newlines would judge "…is checked rather than reviewed" without the
 * clause two lines down that says what the coverage was. Blank lines still
 * separate paragraphs, so unrelated text is never merged.
 */
function sentences(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(\/\/+|\*+|#)\s?/, ""))
    .join("\n")
    .split(/\n\s*\n/)
    // Sentences end at `.`, `!` or `?`. A colon does not end one — it
    // introduces the clause that usually carries the qualifier, so splitting
    // there would judge "…checked rather than reviewed:" without the words
    // that qualify it.
    .flatMap((block) => block.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** The text of any provenance block on a page, for the "beside it" allowance. */
function provenanceBlocks(name, raw) {
  if (!name.endsWith(".html")) return [];
  return byAttribute(parse(raw), "data-provenance").map((element) =>
    visibleText(element).replace(/\s+/g, " ").trim(),
  );
}

async function main() {
  const site = resolve(argument("--site", "_site"));

  let names;
  try {
    names = (await readdir(site, { recursive: true }))
      .filter((name) => SCANNED_EXTENSIONS.some((extension) => name.endsWith(extension)))
      .sort();
  } catch (error) {
    process.stderr.write(`no-unqualified-audited FAILED: cannot read ${site}\n  ${error.message}\n`);
    return 1;
  }

  if (names.length === 0) {
    process.stderr.write(`no-unqualified-audited FAILED: ${site} contains nothing to check.\n`);
    return 1;
  }

  const problems = [];
  let claims = 0;

  for (const name of names) {
    const raw = await readFile(join(site, name), "utf8");
    const blocks = provenanceBlocks(name, raw);

    for (const sentence of sentences(proseOf(name, raw))) {
      if (!CLAIM.test(sentence)) continue;
      claims += 1;
      if (isQualified(sentence)) continue;

      // "…or the adjacent provenance block": a claim inside a provenance block
      // is qualified by a coverage statement shown in that same block.
      const besideCoverage = blocks.some(
        (block) => block.includes(sentence.slice(0, 60)) && isQualified(block),
      );
      if (besideCoverage) continue;

      const word = CLAIM.exec(sentence)?.[1];
      problems.push(
        `${name}: describes something as “${word}” with no coverage qualifier beside it:\n` +
          `      ${JSON.stringify(sentence)}\n` +
          "      Say what the audit covered in the same sentence — for example " +
          "“PARTIAL — charter items 1-4 of 8” — or do not use the word.",
      );
    }
  }

  if (problems.length > 0) {
    process.stderr.write("no-unqualified-audited FAILED\n");
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write(`\n${problems.length} problem(s).\n`);
    return 1;
  }

  process.stdout.write(
    `no-unqualified-audited OK — ${claims} assurance claim(s) across ${names.length} built ` +
      "file(s), every one of them qualified.\n",
  );
  return 0;
}

process.exitCode = await main();
