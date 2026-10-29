// Which Gemini models Smart import uses. Kept apart from the SDK code so pure logic can name them.

/** First read: cheap and usually enough. */
export const GEMINI_MODEL = "gemini-2.5-flash-lite";
/** Second read, only when the first one's answer fails our checks (bad GSTIN, totals don't add up). */
export const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";
