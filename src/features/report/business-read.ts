import { session } from "../records/browser-store";
import { latestFin, loadFin } from "../public-financials/store";
import { latestPoints, loadMarket } from "../market-share/store";
import { currentSegments, loadSegments } from "../segment-fin/store";
import type { PublicContext } from "./business";

/** Reads this browser's stored public data; null when there is none. */
export function readPublicContext(): PublicContext | null {
  let fin: ReturnType<typeof latestFin> = null;
  let share: PublicContext["share"] = [];
  try {
    fin = latestFin(loadFin(window.localStorage, session).state);
  } catch {
    fin = null;
  }
  try {
    share = latestPoints(loadMarket(window.localStorage, session).state);
  } catch {
    share = [];
  }
  let segments: PublicContext["segments"] = [];
  try {
    segments = currentSegments(
      loadSegments(window.localStorage, session).state,
    );
  } catch {
    segments = [];
  }
  if (!fin && !share.length && !segments.length) return null;
  return {
    companies: fin?.file.companies ?? [],
    finRows: fin?.file.rows ?? [],
    share,
    segments,
  };
}
