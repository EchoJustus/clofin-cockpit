/**
 * Rendering an exchange: what went out, what came back, and the command that
 * would do it again.
 *
 * This module is the transparent-client doctrine in its most literal form. Every
 * request the cockpit makes is shown here in full — method, URL, headers, body —
 * beside the response as the browser let this page read it, and beside the cURL
 * that reproduces it. Not a summary, not a status badge with a details link:
 * the exchange.
 *
 * Three details are deliberate.
 *
 * **The pretty view never replaces the raw one.** A parsed field is shown
 * *beside* the body it was read from, never instead of it, so a reader can
 * check the reading. That is the same arrangement the release browser uses for
 * a coverage line and the release body it came from.
 *
 * **Response headers are labelled as what the page could read.** A cross-origin
 * response's headers are visible to a page only if the server named them in
 * `Access-Control-Expose-Headers`. Presenting that filtered list as "the
 * response headers" would be presenting a partial set as a complete one, which
 * is the defect class this project spends the most effort hunting. So the
 * heading says what it is.
 *
 * **A failure renders as fully as a success.** A request that never got a
 * response still shows what was sent and what the browser said about it —
 * usually a bare `TypeError: Failed to fetch`, which is what a blocked
 * preflight or a mixed-content refusal looks like from inside a page. Saying
 * that plainly, with the request beside it, is the difference between a
 * diagnosable failure and a mystery.
 */

import { el } from "./dom.js";
import { curlFor, type Exchange } from "./net.js";

function pre(text: string, className = "raw__pre"): HTMLElement {
  return el("pre", { class: className }, [el("code", {}, [text])]);
}

function headerTable(pairs: readonly (readonly [string, string])[]): HTMLElement {
  if (pairs.length === 0) return el("p", { class: "raw__none" }, ["(none)"]);
  return pre(pairs.map(([name, value]) => `${name}: ${value}`).join("\n"));
}

function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return null;
  }
}

function copyButton(label: string, text: string): HTMLElement {
  const button = el("button", { type: "button", class: "copy copy--inline" }, [label]);
  button.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        button.textContent = "Copied — read it before you run it";
      })
      .catch(() => {
        button.textContent = "Copying was blocked; select the text above instead";
      });
  });
  return button;
}

/** One exchange, whole. */
export function exchangeView(record: Exchange, index: number): HTMLElement {
  const { request, response } = record;
  const pretty = response ? prettyJson(response.body) : null;

  return el("details", { class: "raw", open: index === 0 ? "open" : null }, [
    el("summary", { class: "raw__summary" }, [
      el("span", { class: "raw__method" }, [request.method]),
      el("span", { class: "raw__url" }, [request.url]),
      el(
        "span",
        {
          class: response
            ? response.status >= 200 && response.status < 300
              ? "raw__status raw__status--ok"
              : "raw__status raw__status--refused"
            : "raw__status raw__status--failed",
        },
        [response ? `${response.status} ${response.statusText}` : "no response"],
      ),
      el("span", { class: "raw__timing" }, [`${record.durationMs} ms`]),
    ]),

    el("div", { class: "raw__body" }, [
      el("h4", {}, ["Request, as sent"]),
      pre(`${request.method} ${request.url}`),
      headerTable(request.headers),
      request.body === null ? el("p", { class: "raw__none" }, ["(no body)"]) : pre(request.body),

      el("h4", {}, ["Response, as this page could read it"]),
      response
        ? el("div", {}, [
            pre(`${response.status} ${response.statusText}`),
            el("p", { class: "raw__note" }, [
              "Headers a cross-origin page may read are only those the server named in ",
              "Access-Control-Expose-Headers. This is that list, not necessarily everything ",
              "the server sent.",
            ]),
            headerTable(response.headers),
            response.body === ""
              ? el("p", { class: "raw__none" }, ["(empty body)"])
              : pre(response.body),
            pretty === null
              ? el("p", { class: "raw__note" }, ["The body above is not JSON, so it is shown as it arrived."])
              : el("div", {}, [
                  el("h4", {}, ["The same body, indented"]),
                  el("p", { class: "raw__note" }, [
                    "Whitespace only. It is shown beside the original rather than instead of it.",
                  ]),
                  pre(pretty),
                ]),
          ])
        : el("div", {}, [
            el("p", { class: "raw__failure" }, [record.failure ?? "no response"]),
            el("p", { class: "raw__note" }, [
              "A request that produces no response at all is what a browser reports when it ",
              "refused the request itself — a preflight the server did not answer for this ",
              "origin, a plain-http address on an https page, or an instance that is not ",
              "running. The browser deliberately tells a page nothing more than this.",
            ]),
          ]),

      el("h4", {}, ["The same request, as a command"]),
      pre(curlFor(request), "raw__pre raw__pre--curl"),
      copyButton("Copy the command", curlFor(request)),
    ]),
  ]);
}

/** A list of exchanges, in the order they happened. */
export function exchangeList(records: readonly Exchange[]): HTMLElement {
  if (records.length === 0) {
    return el("p", { class: "raw__none" }, ["No request was made."]);
  }
  return el(
    "div",
    { class: "raws" },
    records.map((record, index) => exchangeView(record, index)),
  );
}
