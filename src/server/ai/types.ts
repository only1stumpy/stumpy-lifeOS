export type AnalysisProvider = "gemini" | "groq";

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
  /** Smallest currency unit: kopecks for PRB, cents for USD. */
  amountMinor: number;
  currency: "PRB" | "USD";
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
  | "invalid_response";

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
