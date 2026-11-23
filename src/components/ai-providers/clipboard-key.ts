export type ClipboardKeyResult =
  | { status: "ok"; text: string }
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "denied" }
  | { status: "unavailable" };

const MAX_KEY_LENGTH = 8_192;

/** Short user-facing hint per failed outcome. Never contains clipboard content. */
export const clipboardKeyHints: Record<Exclude<ClipboardKeyResult["status"], "ok">, string> = {
  empty: "Буфер обмена пуст. Скопируй ключ у провайдера и нажми ещё раз.",
  invalid: "В буфере не похоже на ключ: ключ — одна строка без пробелов.",
  denied: "Вставь ключ долгим нажатием в поле.",
  unavailable: "Вставь ключ долгим нажатием в поле.",
};

/**
 * Reads the clipboard on a user gesture. The text is only returned to the caller (who puts it into
 * the key field); it is never logged or sent anywhere here.
 */
export async function readClipboardKey(clipboard: Pick<Clipboard, "readText"> | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard): Promise<ClipboardKeyResult> {
  if (!clipboard || typeof clipboard.readText !== "function") return { status: "unavailable" };
  let raw: string;
  try {
    raw = await clipboard.readText();
  } catch {
    return { status: "denied" };
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { status: "empty" };
  if (text.length > MAX_KEY_LENGTH || /\s/.test(text)) return { status: "invalid" };
  return { status: "ok", text };
}
