/**
 * The application entry point and its router.
 *
 * Two responsibilities, in this order of importance.
 *
 * **1. Keep the honesty frame true.** Before every render, and again after it,
 * {@link assertFrameIntact} checks that the page still carries the scope
 * statement, that it still matches the canonical constant character for
 * character, and that the provenance region is still there. If any of that has
 * stopped being true the application does not carry on with a degraded page —
 * it replaces the document with a failure notice and stops. A cockpit that
 * kept rendering after losing its disclaimer would be the exact artifact
 * ADR-0020 spent a page refusing to build, so the failure mode is "shows
 * nothing", never "shows the interesting part".
 *
 * That matters more in phase 2 than it did in phase 1. These screens show a
 * *running* payments system answering real requests, which is the single most
 * screenshot-able thing this project produces, and the frame is what travels
 * with the screenshot.
 *
 * That check cannot pass by accident: the frame is emitted at build time and
 * the only element this file ever rewrites is `<main id="view">`.
 *
 * **2. Route.** Four views, addressed by hash so that GitHub Pages needs no
 * server-side rewrite and a deep link survives a reload:
 *
 *     #/releases                       the release list
 *     #/releases/ref-1                 one release and its deployment card
 *     #/instances                      remembered instances, and connecting
 *     #/instances/<encoded base URL>   one connected instance, and its bootstrap
 *
 * State lives here, in module bindings, for the life of the page. Nothing is
 * persisted except the instance registry (`registry.ts`), and nothing is
 * cached: a reload asks the instance again, which is the correct behaviour for
 * a page whose product is what a system is answering *now*.
 */

import { runNext, startRun, verifyManualStep, type Run } from "./bootstrap.js";
import { forgetCredentials } from "./credentials.js";
import { el, replaceChildren, require$ } from "./dom.js";
import { PROVENANCE_MARKER, SCOPE_MARKER, VIEW_ROOT_ID } from "./frame.js";
import { connectToInstance, type ConnectionResult } from "./instance.js";
import { disconnectOrigin, getOwnJson } from "./net.js";
import { decideInstanceUrl } from "./origins.js";
import { PROFILE_DIRECTORY, PROFILE_IDS, readProfile, type Profile } from "./profiles.js";
import * as registry from "./registry.js";
import { fetchReleaseRecords, type ReleaseRecord } from "./releases.js";
import { SCOPE_STATEMENT } from "./scope.js";
import {
  errorView,
  loadingView,
  notFoundView,
  releaseDetailView,
  releaseListView,
  renderProvenance,
} from "./views.js";
import {
  connectedInstanceView,
  instancesView,
  refusedInstanceView,
  type InstanceActions,
} from "./views-instance.js";

/** Thrown when the page can no longer be trusted to be showing its own scope. */
class FrameDamaged extends Error {}

function halt(reason: string): never {
  // Deliberately built with textContent only: at this point the page's own
  // markup is suspect, so nothing is interpolated into it.
  const notice = document.createElement("p");
  notice.textContent =
    "This page has stopped, because it could no longer show the statement it is " +
    `required to show alongside anything else. (${reason})`;
  const wrapper = document.createElement("main");
  wrapper.className = "halted";
  wrapper.append(notice);
  document.body.replaceChildren(wrapper);
  throw new FrameDamaged(reason);
}

/** Verify the frame before trusting the page to display anything else. */
function assertFrameIntact(): void {
  const statement = document.querySelector(`[${SCOPE_MARKER}]`);
  if (!statement) halt("the scope statement is missing from the page");
  if (statement.textContent !== SCOPE_STATEMENT) {
    halt("the scope statement on the page is not the canonical one");
  }
  if (!document.querySelector(`[${PROVENANCE_MARKER}]`)) {
    halt("the provenance region is missing from the page");
  }
}

interface Route {
  readonly name: "releases" | "release" | "instances" | "instance";
  readonly key: string | null;
}

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const release = /^releases\/(.+)$/.exec(hash);
  if (release?.[1]) return { name: "release", key: decodeURIComponent(release[1]) };
  const instance = /^instances\/(.+)$/.exec(hash);
  if (instance?.[1]) return { name: "instance", key: decodeURIComponent(instance[1]) };
  if (hash.startsWith("instances")) return { name: "instances", key: null };
  return { name: "releases", key: null };
}

/** In-memory only, for the life of the page. Nothing here is persisted. */
const state: {
  records: readonly ReleaseRecord[] | null;
  releaseFailure: unknown;
  entries: readonly registry.RegistryEntry[];
  connection: ConnectionResult | null;
  connectingTo: string | null;
  profile: Profile | null;
  profileRefusal: string | null;
  run: Run | null;
} = {
  records: null,
  releaseFailure: null,
  entries: [],
  connection: null,
  connectingTo: null,
  profile: null,
  profileRefusal: null,
  run: null,
};

function navigation(active: Route["name"]): HTMLElement {
  const link = (href: string, text: string, on: boolean) =>
    el("a", { class: on ? "nav__link nav__link--on" : "nav__link", href }, [text]);
  return el("nav", { class: "nav" }, [
    link("#/releases", "Releases", active === "releases" || active === "release"),
    link("#/instances", "Instances", active === "instances" || active === "instance"),
  ]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function openInstance(baseUrl: string, label: string | null): Promise<void> {
  const decision = decideInstanceUrl(baseUrl);
  if (decision.kind === "refused") {
    state.connection = { kind: "refused", baseUrl, reason: decision.reason, exchanges: [] };
    state.connectingTo = null;
    render();
    return;
  }

  // A label of `null` means "selected from the list": keep whatever the
  // operator called it rather than blanking it.
  const remembered = registry.entries().find((entry) => entry.baseUrl === decision.baseUrl) ?? null;
  const entry = { baseUrl: decision.baseUrl, label: label ?? remembered?.label ?? "" };

  // Permit the origin for the duration of the attempt, so `net.ts` will make
  // the two requests the honesty gate is built on. Whether the entry *stays*
  // depends on what the instance answers — see below.
  registry.connect(entry);

  state.connectingTo = decision.baseUrl;
  state.connection = null;
  state.profile = null;
  state.profileRefusal = null;
  state.run = null;
  window.location.hash = `#/instances/${encodeURIComponent(decision.baseUrl)}`;
  render();

  const result = await connectToInstance(decision.baseUrl);
  state.connection = result;
  state.connectingTo = null;

  if (result.kind === "refused") {
    // Withdraw what the attempt granted: no permission to contact it again
    // without a fresh connection, and no credentials held for it.
    disconnectOrigin(decision.origin);
    forgetCredentials(decision.origin);
    // The **entry** only goes if this address was not already remembered. An
    // instance the operator has connected before and has since stopped answers
    // exactly like one that was never CloFin at all, and deleting their saved
    // address because their machine was off would be a surprising thing for a
    // refusal to do.
    if (!remembered) registry.forget(decision.baseUrl);
  }
  state.entries = registry.entries();
  render();
}

async function chooseProfile(profileId: string): Promise<void> {
  state.profile = null;
  state.profileRefusal = null;
  state.run = null;
  render();

  if (!PROFILE_IDS.includes(profileId)) {
    state.profileRefusal = `${profileId} is not a profile this build ships.`;
    render();
    return;
  }

  try {
    const document_ = await getOwnJson(`${PROFILE_DIRECTORY}/${profileId}.json`);
    const result = readProfile(document_, JSON.stringify(document_, null, 2));
    if (result.kind === "refused") {
      state.profileRefusal = `${profileId} was refused: ${result.reason}. Nothing was run.`;
    } else if (result.profile.id !== profileId) {
      state.profileRefusal =
        `${profileId}.json declares the id "${result.profile.id}". A profile whose name and ` +
        "id disagree is not run.";
    } else {
      state.profile = result.profile;
    }
  } catch (error) {
    state.profileRefusal =
      `${profileId} could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  render();
}

function beginRun(): void {
  const connection = state.connection;
  if (!connection || connection.kind !== "connected" || !state.profile) return;
  // Mints the actors and renders the plan. No request is made: the first one is
  // the operator's next click, which is the whole shape of this runner.
  state.run = startRun(state.profile, connection.baseUrl, connection.origin);
  render();
}

async function runNextStep(): Promise<void> {
  const run = state.run;
  if (!run) return;
  state.run = await runNext(run);
  render();
}

async function confirmManualStep(): Promise<void> {
  if (!state.run) return;
  state.run = await verifyManualStep(state.run);
  render();
}

const actions: InstanceActions = {
  connect: (baseUrl, label) => void openInstance(baseUrl, label),
  select: (baseUrl) => void openInstance(baseUrl, null),
  forget: (baseUrl) => {
    state.entries = registry.forget(baseUrl);
    if (state.connection?.baseUrl === baseUrl) {
      state.connection = null;
      state.run = null;
      state.profile = null;
    }
    render();
  },
  chooseProfile: (profileId) => void chooseProfile(profileId),
  beginRun: () => beginRun(),
  runNextStep: () => void runNextStep(),
  confirmManualStep: () => void confirmManualStep(),
  restart: () => {
    state.run = null;
    render();
  },
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function releaseBody(route: Route): HTMLElement {
  if (state.releaseFailure !== null) return errorView(state.releaseFailure);
  if (state.records === null) return loadingView();
  if (route.name === "release") {
    const record = state.records.find((candidate) => candidate.release.tag === route.key) ?? null;
    return record ? releaseDetailView(record) : notFoundView(route.key ?? "");
  }
  return releaseListView(state.records);
}

function instanceBody(route: Route): HTMLElement {
  // The list route shows the list, whatever happened last. A connection — or a
  // refusal — belongs to the address in the URL, so navigating back to
  // `#/instances` must not keep rendering it.
  if (route.name === "instances") return instancesView(state.entries, actions, null);

  if (state.connectingTo !== null) {
    return el("section", { class: "panel" }, [
      el("h1", {}, ["Connecting"]),
      el("p", {}, [`Asking ${state.connectingTo} what it is…`]),
    ]);
  }
  const connection = state.connection;
  if (!connection) return instancesView(state.entries, actions, null);
  if (connection.kind === "refused") return refusedInstanceView(connection);
  return connectedInstanceView(
    connection,
    state.records,
    // Three different reasons a tag was not compared, and they are not the same
    // sentence. "Still loading" is not "could not be read", and neither is
    // "there is no match" — which is the answer this must never collapse into.
    state.releaseFailure !== null
      ? "the published releases could not be read, so this commit was not compared with any tag"
      : "the published releases have not finished loading, so this commit has not been compared with any tag yet",
    PROFILE_IDS,
    state.profile,
    state.profileRefusal,
    state.run,
    actions,
  );
}

function render(): void {
  assertFrameIntact();

  const view = require$<HTMLElement>(`#${VIEW_ROOT_ID}`);
  const provenance = require$(`[${PROVENANCE_MARKER}]`);
  const route = currentRoute();

  if (route.name === "release" && state.records !== null && state.releaseFailure === null) {
    renderProvenance(
      provenance,
      state.records.find((candidate) => candidate.release.tag === route.key) ?? null,
    );
  } else {
    renderProvenance(provenance, null);
  }

  replaceChildren(
    view,
    navigation(route.name),
    route.name === "releases" || route.name === "release"
      ? releaseBody(route)
      : instanceBody(route),
  );

  // Again afterwards: the render above must not have been able to touch the
  // frame, and this is what makes "must not" checkable rather than intended.
  assertFrameIntact();
}

function onHashChange(): void {
  const route = currentRoute();
  // A deep link to an instance connects to it, so that a bookmarked address
  // behaves exactly as clicking it in the list does — same code path, same
  // honesty gate.
  if (route.name === "instance" && route.key && state.connection?.baseUrl !== route.key) {
    void openInstance(route.key, null);
    return;
  }
  render();
}

async function start(): Promise<void> {
  state.entries = registry.permitRemembered();
  render();

  // A deep link connects while the release list is still loading, rather than
  // after it: an operator who bookmarked an instance is asking about the
  // instance, and the tag comparison settles when the list arrives. The final
  // render below is what settles it — without it, "not compared yet" would
  // stay on screen after the comparison had become possible.
  const route = currentRoute();
  const deepLink =
    route.name === "instance" && route.key ? openInstance(route.key, null) : null;

  try {
    state.records = await fetchReleaseRecords();
  } catch (error) {
    state.releaseFailure = error;
  }

  render();
  if (deepLink) await deepLink;
}

window.addEventListener("hashchange", onHashChange);
void start();
