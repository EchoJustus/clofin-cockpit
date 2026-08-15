/**
 * A small HTML reader for the two checks. Not a browser, and not trying to be.
 *
 * The checks have to answer two questions about the built page: *what is the
 * exact text of the element marked `data-scope-statement`*, and *what text
 * does this page contain at all*. A regular expression cannot answer the first
 * one honestly — it cannot tell an element's own text from its children's —
 * and the first question is the one `scope-verbatim` exists to ask. So this
 * builds a real (small) tree.
 *
 * It handles what this repository's own HTML uses and nothing more: elements,
 * attributes, comments, the doctype, void elements, raw-text elements, and the
 * handful of character references that appear in generated markup. It is
 * checking a page this repository produced, not the open web.
 *
 * Written with no dependencies for the same reason `clofin-trace`'s checks are
 * the Python standard library: a check whose supply chain is larger than the
 * thing it checks is a check nobody can vouch for.
 */

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Elements whose content is text, not markup. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

const CHARACTER_REFERENCES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
};

/** Decode the character references that generated markup actually contains. */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(CHARACTER_REFERENCES, body) ? CHARACTER_REFERENCES[body] : whole;
  });
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attributes[match[1].toLowerCase()] = decodeEntities(value);
  }
  return attributes;
}

/**
 * Parse HTML into a tree of `{ tag, attributes, children }` element nodes and
 * plain strings for text.
 */
export function parse(html) {
  const root = { tag: "#root", attributes: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];

  let index = 0;
  while (index < html.length) {
    const next = html.indexOf("<", index);

    if (next < 0) {
      if (index < html.length) top().children.push(html.slice(index));
      break;
    }

    if (next > index) top().children.push(html.slice(index, next));

    // Comment
    if (html.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4);
      const stop = end < 0 ? html.length : end + 3;
      top().children.push({ tag: "#comment", attributes: {}, children: [html.slice(next + 4, end < 0 ? html.length : end)] });
      index = stop;
      continue;
    }

    // Doctype or processing instruction
    if (html.startsWith("<!", next) || html.startsWith("<?", next)) {
      const end = html.indexOf(">", next);
      index = end < 0 ? html.length : end + 1;
      continue;
    }

    // Closing tag
    const closing = /^<\/\s*([a-zA-Z][-a-zA-Z0-9]*)\s*>/.exec(html.slice(next));
    if (closing) {
      const name = closing[1].toLowerCase();
      for (let depth = stack.length - 1; depth > 0; depth -= 1) {
        if (stack[depth].tag === name) {
          stack.length = depth;
          break;
        }
      }
      index = next + closing[0].length;
      continue;
    }

    // Opening tag
    const opening = /^<([a-zA-Z][-a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(next));
    if (!opening) {
      top().children.push("<");
      index = next + 1;
      continue;
    }

    const name = opening[1].toLowerCase();
    const rawAttributes = opening[2] ?? "";
    const selfClosing = rawAttributes.trimEnd().endsWith("/");
    const node = {
      tag: name,
      attributes: parseAttributes(selfClosing ? rawAttributes.trimEnd().slice(0, -1) : rawAttributes),
      children: [],
    };
    top().children.push(node);
    index = next + opening[0].length;

    if (VOID_ELEMENTS.has(name) || selfClosing) continue;

    if (RAW_TEXT_ELEMENTS.has(name)) {
      const closeAt = html.toLowerCase().indexOf(`</${name}`, index);
      const stop = closeAt < 0 ? html.length : closeAt;
      if (stop > index) node.children.push(html.slice(index, stop));
      const after = html.indexOf(">", stop);
      index = closeAt < 0 ? html.length : after < 0 ? html.length : after + 1;
      continue;
    }

    stack.push(node);
  }

  return root;
}

export function isElement(node) {
  return typeof node === "object" && node !== null && typeof node.tag === "string";
}

/** Every element in the tree, in document order. */
export function* elements(node) {
  for (const child of node.children ?? []) {
    if (!isElement(child)) continue;
    if (child.tag !== "#comment") yield child;
    yield* elements(child);
  }
}

/** The text of an element and its descendants, entity-decoded. */
export function textOf(node) {
  if (typeof node === "string") return decodeEntities(node);
  if (!isElement(node) || node.tag === "#comment") return "";
  return (node.children ?? []).map(textOf).join("");
}

/** Elements carrying an attribute, by attribute name. */
export function byAttribute(root, attribute) {
  return [...elements(root)].filter((element) => Object.hasOwn(element.attributes, attribute));
}

/**
 * All human-visible text on the page: everything except `<script>`, `<style>`
 * and comments.
 */
export function visibleText(node) {
  if (typeof node === "string") return decodeEntities(node);
  if (!isElement(node)) return "";
  if (node.tag === "#comment" || RAW_TEXT_ELEMENTS.has(node.tag)) return "";
  return (node.children ?? []).map(visibleText).join(" ");
}
