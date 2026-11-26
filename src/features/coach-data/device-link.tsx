"use client";
import { useEffect, useId, useState } from "react";
import { sheetIdFrom } from "../../lib/connectors/sheet-source";
import { session } from "../records/browser-store";
import { loadCoachSource, saveCoachSource } from "./store";
import { finSourceKey, finSourceSchema } from "../public-financials/store";
import { marketSourceKey, marketSourceSchema } from "../market-share/store";

/**
 * "Open on another device": the sheet IDs travel in the URL fragment
 * (#connect=…), which browsers never send to the server. Opening the link
 * connects the three sheet sources in that browser, then removes the fragment.
 * Nothing else (records, imported data) is copied — each device syncs from
 * the same sheet.
 */
type ProjectOption = { id: string; kind: string; archivedAt: string | null };

const PARAM = "connect";

function readJson(key: string) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Current sheet IDs of this browser, or null when nothing is connected. */
function currentLink(): string | null {
  const coach = (() => {
    try {
      return loadCoachSource(window.localStorage, session);
    } catch {
      return null;
    }
  })();
  const fin = finSourceSchema.safeParse(readJson(finSourceKey(session)));
  const market = marketSourceSchema.safeParse(
    readJson(marketSourceKey(session)),
  );
  const params = new URLSearchParams();
  if (coach) {
    params.set("ga", coach.sheetId);
    params.set("p", coach.projectId);
  }
  if (fin.success) params.set("dart", fin.data.sheetId);
  if (market.success) params.set("share", market.data.sheetId);
  if (![...params.keys()].length) return null;
  const url = new URL(window.location.href);
  url.search = "?tab=data";
  url.hash = `${PARAM}=${encodeURIComponent(params.toString())}`;
  return url.toString();
}

/** Applies a #connect=… link once; returns a message for the user. */
export function applyDeviceLink(projects: ProjectOption[]): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  const raw = new URLSearchParams(hash).get(PARAM);
  if (!raw) return null;
  // Remove the fragment first so the IDs do not linger in the address bar.
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  try {
    const p = new URLSearchParams(raw);
    const done: string[] = [];
    const coachProjects = projects.filter(
      (x) => x.kind === "coach" && !x.archivedAt,
    );
    if (p.get("ga")) {
      const projectId =
        coachProjects.find((x) => x.id === p.get("p"))?.id ??
        coachProjects[0]?.id;
      if (projectId) {
        saveCoachSource(window.localStorage, session, {
          sheetId: sheetIdFrom(p.get("ga")!),
          projectId,
          lastSyncAt: null,
          lastOk: null,
          lastResult: null,
        });
        done.push("GA");
      }
    }
    const empty = { lastSyncAt: null, lastOk: null, lastResult: null };
    if (p.get("dart")) {
      window.localStorage.setItem(
        finSourceKey(session),
        JSON.stringify(
          finSourceSchema.parse({
            sheetId: sheetIdFrom(p.get("dart")!),
            ...empty,
          }),
        ),
      );
      done.push("공시");
    }
    if (p.get("share")) {
      window.localStorage.setItem(
        marketSourceKey(session),
        JSON.stringify(
          marketSourceSchema.parse({
            sheetId: sheetIdFrom(p.get("share")!),
            ...empty,
          }),
        ),
      );
      done.push("점유율");
    }
    if (!done.length) return "연결 링크에 사용할 수 있는 시트가 없습니다.";
    return `이 기기를 시트에 연결했습니다 (${done.join("·")}). 아래에서 자동으로 동기화한 뒤 성과 탭에서 볼 수 있습니다.`;
  } catch {
    return "연결 링크가 올바르지 않습니다. PC에서 링크를 다시 복사해 주세요.";
  }
}

const MESSAGE_KEY = "pmzip:device-link-message";

/**
 * Applies a #connect=… link, then reloads the data tab once so every panel
 * starts with its new sheet source and syncs. The message survives the reload
 * in sessionStorage.
 */
export function DeviceLinkHandler({ projects }: { projects: ProjectOption[] }) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const result = applyDeviceLink(projects);
      if (result) {
        try {
          sessionStorage.setItem(MESSAGE_KEY, result);
        } catch {
          // The page still connects; only the message is lost.
        }
        window.location.replace(window.location.pathname + "?tab=data");
        return;
      }
      try {
        const saved = sessionStorage.getItem(MESSAGE_KEY);
        if (saved) {
          sessionStorage.removeItem(MESSAGE_KEY);
          setMessage(saved);
        }
      } catch {
        // No message to show.
      }
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per load
  }, []);
  if (!message) return null;
  return (
    <p className="notice" role="status">
      {message}
    </p>
  );
}

/** Data tab: copy/share the link for another device. */
export function DeviceLinkPanel() {
  const ids = useId();
  const [link] = useState(() =>
    typeof window === "undefined" ? null : currentLink(),
  );
  const [copied, setCopied] = useState("");
  if (!link) return null;
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <section className="panel coach-data" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`}>다른 기기에서 보기</h2>
      <p className="subtle">
        이 링크를 휴대폰 등 다른 기기에서 열면 같은 시트가 자동으로 연결됩니다.
        시트를 아는 사람은 숫자를 볼 수 있으니 본인에게만 보내세요. 과제·원문
        기록은 옮겨지지 않습니다.
      </p>
      <div className="field">
        <label htmlFor={`${ids}-link`}>연결 링크</label>
        <input
          id={`${ids}-link`}
          value={link}
          readOnly
          onFocus={(e) => e.target.select()}
        />
      </div>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied("링크를 복사했습니다. 휴대폰으로 보내 여세요.");
            } catch {
              setCopied(
                "복사하지 못했습니다. 위 칸을 길게 눌러 직접 복사해 주세요.",
              );
            }
          }}
        >
          연결 링크 복사
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() =>
              navigator
                .share({ title: "PM.zip 연결", url: link })
                .catch(() => undefined)
            }
          >
            공유
          </button>
        )}
      </div>
      {copied && (
        <p className="subtle" role="status">
          {copied}
        </p>
      )}
    </section>
  );
}
