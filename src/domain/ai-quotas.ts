export type AiQuotaMetric = {
  id: string;
  label: string;
  limit: number | null;
  used: number | null;
  unit: "requests" | "tokens";
  window: string | null;
  updatedAt: string | null;
};

export type AiQuotaSnapshot = {
  provider: "gemini";
  model: string;
  status: "ready" | "not_configured" | "permission_missing" | "unavailable";
  observedAt: string | null;
  metrics: AiQuotaMetric[];
  message: string;
  dashboardUrl: "https://aistudio.google.com/";
};
