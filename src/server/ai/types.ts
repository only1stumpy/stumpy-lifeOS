export type AnalysisProvider = "gemini" | "groq" | "openai-compatible";

/**
 * Read-only reference question with a compact JSON snapshot assembled by the caller.
 * Limits: question <= 2,000 chars; serialized JSON context <= 8,000 chars.
 */
export type LifeOSQuestionInput = {
  question: string;
  context: string;
};

/** Plain-text Russian answer returned by the configured AI provider. */
export type LifeOSQuestionResult = {
  answer: string;
  provider: AnalysisProvider;
  model: string;
};

export type AnalysisFood = {
  label: string;
  portionLabel: string;
  calories: number;
  proteinGrams: number;
  fatGrams: number;
  carbsGrams: number;
  estimated: boolean;
};

export type AnalysisMoney = {
  label: string;
  /** Hundredths of the currency (kopecks, cents). */
  amountMinor: number;
  currency: string;
  kind: "expense" | "income";
  category: string | null;
};

export type AnalysisEntry = {
  food: AnalysisFood | null;
  money: AnalysisMoney | null;
  occurredAt: string;
};

export type AnalysisResult = {
  entries: AnalysisEntry[];
  clarification: string | null;
  provider: AnalysisProvider | "local";
  model: string | null;
};

export type AnalyzeMessageInput = {
  text: string;
  image?: {
    mimeType: string;
    dataBase64: string;
  };
  clarificationHistory?: ClarificationMessage[];
  timeZone: string;
  now: string;
  templates?: unknown[];
  categories?: string[];
  previousDraft?: unknown;
  /** Modules the user enabled; records for other modules must not be produced. */
  enabledModules?: string[];
  /** Owner's base currency: used when a message names no currency. */
  baseCurrency?: string;
};

/** Short, text-only conversation history for an unanswered AI clarification. */
export type ClarificationMessage = {
  role: "user" | "assistant";
  text: string;
};

export type AIAnalysisErrorCode =
  | "invalid_input"
  | "not_configured"
  | "provider_failed"
  | "provider_mixed"
  | "provider_unavailable"
  | "provider_configuration"
  | "quota_exceeded"
  | "credits_exhausted"
  | "invalid_response"
  | "time_budget";

export class AIAnalysisError extends Error {
  readonly code: AIAnalysisErrorCode;
  readonly attemptedProviders: readonly AnalysisProvider[];

  constructor(
    code: AIAnalysisErrorCode,
    message: string,
    attemptedProviders: readonly AnalysisProvider[] = [],
  ) {
    super(message);
    this.name = "AIAnalysisError";
    this.code = code;
    this.attemptedProviders = attemptedProviders;
  }
}
