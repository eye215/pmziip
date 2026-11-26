import { session } from "../records/browser-store";
import { latestSnapshots, loadCoach } from "./store";
import { releaseWindows, type CompareWindow } from "./release-compare";

/** GA windows around a release from this browser's imported GA data. */
export function readWindows(
  projectId: string,
  releaseDay: string,
): CompareWindow[] {
  try {
    const list = latestSnapshots(
      loadCoach(window.localStorage, session).state,
      projectId,
    ).map((x) => x.latest);
    return releaseWindows(list, releaseDay);
  } catch {
    return [];
  }
}
