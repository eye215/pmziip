// Provider contract and mock-only orchestration. No production API, credential or network client exists here.
// A future real provider must run on the server after explicit source/organization approval.
import {
  ruleSuggestion,
  validateSuggestion,
  type Goal,
} from "../../features/measurement/suggestions";
import type { RecordsState } from "../../features/records/model";
export type MockProvider = {
  kind: "mock";
  generate: (
    request: { initiativeId: string; goal: Goal },
    signal: AbortSignal,
  ) => Promise<unknown>;
};
export async function suggestWithProvider(
  s: RecordsState,
  initiativeId: string,
  goal: Goal,
  provider?: MockProvider,
  timeoutMs = 1000,
) {
  const fallback = (reason: string) => ({
    suggestion: ruleSuggestion(s, initiativeId, goal),
    origin: "rules" as const,
    reason,
  });
  if (!provider) return fallback("not_configured");
  if (provider.kind !== "mock") return fallback("unsupported_provider");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      provider.generate({ initiativeId, goal }, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, timeoutMs);
      }),
    ]);
    if (controller.signal.aborted) return fallback("timeout");
    try {
      return {
        suggestion: validateSuggestion(s, initiativeId, value),
        origin: "mock" as const,
        reason: "mock_validated",
      };
    } catch {
      return fallback("invalid_output");
    }
  } catch {
    return fallback(controller.signal.aborted ? "timeout" : "provider_error");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
