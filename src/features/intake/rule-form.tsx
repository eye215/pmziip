"use client";

import { useId, useState } from "react";
import {
  ruleChannelLabels,
  ruleChannels,
  ruleFieldLabels,
  ruleFields,
  ruleLabel,
  ruleModeLabels,
  ruleModes,
  ruleSchema,
  type RuleChannel,
  type RuleField,
  type RuleMode,
} from "../../lib/connectors/exclude-rules";
import { runtime } from "../records/browser-store";
import { addExcludeRule, removeExcludeRule, useRules } from "./use-rules";

/** Add one exclusion rule (optionally prefilled from a message). */
export function RuleForm({
  field: initialField = "title",
  text: initialText = "",
  channel: initialChannel = "all",
  mode: initialMode = "exclude",
  onDone,
}: {
  field?: RuleField;
  text?: string;
  channel?: RuleChannel;
  mode?: RuleMode;
  onDone?: (message: string) => void;
}) {
  const ids = useId();
  const [mode, setMode] = useState<RuleMode>(initialMode);
  const [channel, setChannel] = useState<RuleChannel>(initialChannel);
  const [field, setField] = useState<RuleField>(initialField);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState("");
  function save() {
    const r = ruleSchema.safeParse({
      id: runtime.id(),
      mode,
      channel,
      field,
      text,
      createdAt: runtime.now(),
    });
    if (!r.success) {
      setError(r.error.issues[0].message);
      return;
    }
    const added = addExcludeRule(r.data);
    setError("");
    setText("");
    onDone?.(
      added
        ? `규칙을 추가했습니다: ${ruleLabel(r.data)}`
        : "같은 규칙이 이미 있습니다.",
    );
  }
  return (
    <div className="rule-form">
      <div className="field">
        <label htmlFor={`${ids}-m`}>규칙 종류</label>
        <select
          id={`${ids}-m`}
          value={mode}
          onChange={(e) => setMode(e.target.value as RuleMode)}
        >
          {ruleModes.map((m) => (
            <option key={m} value={m}>
              {ruleModeLabels[m]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-c`}>대상</label>
        <select
          id={`${ids}-c`}
          value={channel}
          onChange={(e) => setChannel(e.target.value as RuleChannel)}
        >
          {ruleChannels.map((c) => (
            <option key={c} value={c}>
              {ruleChannelLabels[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-f`}>어디에서 찾을까요</label>
        <select
          id={`${ids}-f`}
          value={field}
          onChange={(e) => setField(e.target.value as RuleField)}
        >
          {ruleFields.map((f) => (
            <option key={f} value={f}>
              {ruleFieldLabels[f]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-t`}>포함된 글자</label>
        <input
          id={`${ids}-t`}
          value={text}
          maxLength={100}
          placeholder={
            field === "domain" ? "예: newsletter.example" : "예: 주간 뉴스레터"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={save}>
          규칙 추가
        </button>
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </div>
  );
}

/** List + add form, shown in the intake review. */
export function RuleManager({ onDone }: { onDone: (m: string) => void }) {
  const rules = useRules();
  return (
    <details className="intake-rules">
      <summary>수집 규칙 {rules.length}개</summary>
      <p className="subtle">
        &apos;숨기기&apos; 규칙에 맞거나, &apos;남기기&apos; 키워드가 있는
        채널에서 키워드가 없는 메일·메시지는 숨기고 요구사항 후보를 만들지
        않습니다. 붙여넣은 글과 캘린더는 거르지 않습니다. 원문은 지우지 않으며,
        숨긴 항목 보기에서 직접 등록할 수 있습니다.
      </p>
      {rules.length > 0 && (
        <ul className="rule-list">
          {rules.map((r) => (
            <li key={r.id}>
              <span>{ruleLabel(r)}</span>
              <button
                type="button"
                aria-label={`${ruleLabel(r)} 규칙 지우기`}
                onClick={() => {
                  removeExcludeRule(r.id);
                  onDone(`제외 규칙을 지웠습니다: ${ruleLabel(r)}`);
                }}
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      )}
      <RuleForm onDone={onDone} />
    </details>
  );
}
