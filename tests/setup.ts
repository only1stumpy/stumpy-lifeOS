// Test-only switch: the AI adapters are exercised through environment keys without a user selection.
// Production never sets this, so deployment-wide keys cannot serve real users.
process.env.LIFEOS_ALLOW_ENV_AI_KEYS = "1";
// A throwaway key so stored provider keys can be encrypted in tests that connect accounts.
process.env.AI_PROVIDER_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
