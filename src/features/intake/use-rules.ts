"use client";
import { useSyncExternalStore } from "react";
import type { ExcludeRule } from "../../lib/connectors/exclude-rules";
import { session } from "../records/browser-store";
import { addRule, loadRules, removeRule, rulesKey } from "./rules-store";

const EVENT = "pmzip:rules";
let cache: { raw: string | null; rules: ExcludeRule[] } = {
  raw: null,
  rules: [],
};
const empty: ExcludeRule[] = [];
function snapshot(): ExcludeRule[] {
  try {
    const raw = window.localStorage.getItem(rulesKey(session));
    if (raw === cache.raw) return cache.rules;
    cache = { raw, rules: loadRules(window.localStorage, session).rules };
    return cache.rules;
  } catch {
    return empty;
  }
}
function subscribe(fn: () => void) {
  const events = [EVENT, "pmzip:synced", "storage"];
  for (const e of events) window.addEventListener(e, fn);
  return () => {
    for (const e of events) window.removeEventListener(e, fn);
  };
}
/** Exclusion rules of this workspace; re-renders on change or sync. */
export const useRules = () =>
  useSyncExternalStore(subscribe, snapshot, () => empty);

export function addExcludeRule(rule: ExcludeRule) {
  const r = addRule(window.localStorage, session, rule);
  window.dispatchEvent(new Event(EVENT));
  return r.added;
}
export function removeExcludeRule(id: string) {
  removeRule(window.localStorage, session, id);
  window.dispatchEvent(new Event(EVENT));
}
