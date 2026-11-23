/**
 * Deterministic default ranking of a provider's free models. Pure: it only looks at what the provider really
 * returns (id, the vision flag, context length) and never at the user's saved selection or queue.
 *
 * Order key, each step breaks ties of the previous one:
 *  1. unsuitable models last (embedding, audio, speech, guard/safety, moderation, rerank, image/live generation);
 *  2. vision models ("text + photo") before text-only, because food and receipt recognition needs them;
 *  3. tiny models (up to 4B parameters, "nano"/"tiny") after normal ones;
 *  4. provider rules, see PROVIDER_RULES;
 *  5. newer version (3.3 > 3.1), bigger size (70b > 8b), bigger context;
 *  6. id, alphabetically: the last tie-break only, so the order is stable.
 *
 * Provider rules (higher family score first):
 *  - gemini: pro (3) > flash (2) > flash-lite (1); newer first.
 *  - groq: gpt-oss, llama-4, llama-3.3, qwen (2) > everything else, e.g. 8b-instant (1); then version and size.
 *  - cloudflare: vision first (the free catalog is fixed, context is unknown), then gpt-oss, llama-4, llama-3.3,
 *    mistral-small (2) > everything else (1); then version and size.
 *  - openrouter (`:free`): bigger context first, then version, then size.
 *  - custom: nothing is known about the provider, only the vision flag and a stable id order.
 */
export type RankableModel = {
  id: string;
  supportsImages: boolean;
  contextLength: number | null;
};

type RankProviderId = "gemini" | "groq" | "cerebras" | "openrouter" | "cloudflare" | "custom";

type ProviderRule = {
  /** Parse version, size and context at all (false = vision flag and id order only). */
  inspectId: boolean;
  /** Compare context length before version and size. */
  contextFirst: boolean;
  family: (name: string) => number;
};

const PROVIDER_RULES: Record<RankProviderId, ProviderRule> = {
  gemini: {
    inspectId: true,
    contextFirst: false,
    family: (name) => name.includes("flash-lite") ? 1 : name.includes("flash") ? 2 : name.includes("pro") ? 3 : 0,
  },
  groq: {
    inspectId: true,
    contextFirst: false,
    family: (name) => /gpt-oss|llama-4|llama-3\.3|qwen/.test(name) ? 2 : 1,
  },
  cerebras: { inspectId: true, contextFirst: false, family: () => 0 },
  cloudflare: {
    inspectId: true,
    contextFirst: false,
    family: (name) => /gpt-oss|llama-4|llama-3\.3|mistral-small/.test(name) ? 2 : 1,
  },
  openrouter: { inspectId: true, contextFirst: true, family: () => 0 },
  custom: { inspectId: false, contextFirst: false, family: () => 0 },
};

const UNSUITABLE_TOKENS = new Set([
  "embed", "embedding", "embeddings", "whisper", "tts", "speech", "audio", "guard", "safeguard", "safety",
  "moderation", "rerank", "reranker", "transcribe", "orpheus", "imagen", "image", "live", "lyria", "veo",
]);
const TINY_TOKENS = new Set(["nano", "tiny"]);
const TINY_SIZE_B = 4;
/** `70b`, `8b`, `e2b`, `0.6b`, not part of a longer word. */
const SIZE_PATTERN = /(?:^|[^a-z\d.])e?(\d+(?:\.\d+)?)b(?![a-z])/;

/** Id without vendor prefix and `:free`-style suffix, lower-case. */
function bareName(id: string): string {
  const afterVendor = id.slice(id.lastIndexOf("/") + 1);
  return afterVendor.replace(/:[a-z0-9-]+$/i, "").toLowerCase();
}

function tokens(name: string): string[] {
  return name.split(/[^a-z0-9]+/).filter(Boolean);
}

export function isUnsuitableModel(id: string): boolean {
  return tokens(bareName(id)).some((token) => UNSUITABLE_TOKENS.has(token));
}

export type ParsedModelId = { version: number[]; sizeB: number | null };

/** Version (`3.3` -> [3, 3]) and size in billions of parameters, read only from the id. */
export function parseModelId(id: string): ParsedModelId {
  const name = bareName(id);
  const sizeMatch = SIZE_PATTERN.exec(name);
  const sizeB = sizeMatch ? Number(sizeMatch[1]) : null;
  const rest = sizeMatch ? name.replace(SIZE_PATTERN, "-") : name;
  const versionMatch = /(\d+(?:\.\d+)*)/.exec(rest);
  return { version: versionMatch ? versionMatch[1]!.split(".").map(Number) : [], sizeB };
}

function compareVersions(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isTiny(name: string, sizeB: number | null): boolean {
  return (sizeB !== null && sizeB <= TINY_SIZE_B) || tokens(name).some((token) => TINY_TOKENS.has(token));
}

function compareModels(providerId: RankProviderId, left: RankableModel, right: RankableModel): number {
  const rule = PROVIDER_RULES[providerId];
  const unsuitable = Number(isUnsuitableModel(left.id)) - Number(isUnsuitableModel(right.id));
  if (unsuitable !== 0) return unsuitable;
  const vision = Number(right.supportsImages) - Number(left.supportsImages);
  if (vision !== 0) return vision;

  if (rule.inspectId) {
    const leftParsed = parseModelId(left.id);
    const rightParsed = parseModelId(right.id);
    const tiny = Number(isTiny(bareName(left.id), leftParsed.sizeB)) - Number(isTiny(bareName(right.id), rightParsed.sizeB));
    if (tiny !== 0) return tiny;
    const family = rule.family(bareName(right.id)) - rule.family(bareName(left.id));
    if (family !== 0) return family;
    const context = (right.contextLength ?? 0) - (left.contextLength ?? 0);
    if (rule.contextFirst && context !== 0) return context;
    const version = compareVersions(rightParsed.version, leftParsed.version);
    if (version !== 0) return version;
    const size = (rightParsed.sizeB ?? 0) - (leftParsed.sizeB ?? 0);
    if (size !== 0) return size;
    if (!rule.contextFirst && context !== 0) return context;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** A new array; the input is not modified. Same input set gives the same order whatever its original order. */
export function rankAiModels<T extends RankableModel>(providerId: RankProviderId, models: readonly T[]): T[] {
  return models.slice().sort((left, right) => compareModels(providerId, left, right));
}

const DEFAULT_VISION_PICKS = 3;
const DEFAULT_TEXT_PICKS = 1;

/**
 * Ids enabled by default for a NEW account of a provider: the best vision models (up to three) plus one good
 * text model; without vision models, the best three text models. Never picks unsuitable models unless there
 * is nothing else, so the queue is not empty. Takes the already ranked list.
 */
export function defaultPreselection<T extends RankableModel>(ranked: readonly T[]): string[] {
  const suitable = ranked.filter((model) => !isUnsuitableModel(model.id));
  if (suitable.length === 0) return ranked.slice(0, 1).map((model) => model.id);
  const vision = suitable.filter((model) => model.supportsImages).slice(0, DEFAULT_VISION_PICKS);
  const text = suitable.filter((model) => !model.supportsImages);
  const picks = vision.length === 0 ? text.slice(0, DEFAULT_VISION_PICKS) : [...vision, ...text.slice(0, DEFAULT_TEXT_PICKS)];
  return picks.map((model) => model.id);
}
