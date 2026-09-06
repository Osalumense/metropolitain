import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config/index.js";

const loadCache = (): Map<string, string> => {
  if (!existsSync(config.translateCachePath)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(config.translateCachePath, "utf-8")) as Record<string, string>;
    return new Map(Object.entries(raw));
  } catch (err) {
    console.error("[translate] cache file unreadable, starting fresh:", err);
    return new Map();
  }
};

const cache = loadCache();

// Fire-and-forget: a disk write must never slow down or fail a translation response, and
// losing the very latest entry on an ungraceful shutdown just means one extra DeepL call
// on the next boot — cheap, unlike a full cold-cache burst across every distinct message.
const persistCache = () => {
  try {
    mkdirSync(path.dirname(config.translateCachePath), { recursive: true });
    writeFileSync(config.translateCachePath, JSON.stringify(Object.fromEntries(cache)));
  } catch (err) {
    console.error("[translate] failed to persist cache:", err);
  }
};

// Even with the cache persisted to disk (see loadCache/persistCache above), a first-ever
// boot or a genuinely new batch of disruptions still means several distinct messages need
// translating in one poll cycle — dozens of DeepL calls fired in a tight sequential burst,
// which real-world testing confirmed is enough to trip DeepL's own rate limit on its own
// (repeated 429s, every disruption falling back to French network-wide until the limit
// window passed) even though the calls are already sequential, not parallel. A floor on
// the gap between real (non-cached) calls keeps a burst from ever bunching up in the first
// place — cheap insurance, since it only adds delay when a call is actually about to hit
// the network, never to a cache hit.
const MIN_CALL_INTERVAL_MS = 120;
let lastCallAt = 0;

const waitForCallSlot = async () => {
  const waitMs = MIN_CALL_INTERVAL_MS - (Date.now() - lastCallAt);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastCallAt = Date.now();
};

/** One retry after a short pause, respecting DeepL's own Retry-After header when it sends
 *  one, is usually enough on top of the pacing above — the limit is short-lived, not a
 *  hard quota block. */
const attemptTranslation = async (frenchText: string, apiKey: string): Promise<{ ok: true; text: string } | { ok: false; retryAfterMs: number | null }> => {
  const res = await fetch(config.deeplUrl, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: [frenchText], source_lang: "FR", target_lang: "EN" }),
  });
  if (res.status === 429) {
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
    return { ok: false, retryAfterMs };
  }
  if (!res.ok) throw new Error(`DeepL ${res.status}`);
  const data = (await res.json()) as { translations: { text: string }[] };
  return { ok: true, text: data.translations[0]?.text ?? frenchText };
};

/**
 * Translates French disruption text to English, once per distinct message.
 * Cached on disk (see PRODUCT.md: cost scales with distinct messages/day, not
 * polls or visitors) so a redeploy doesn't force re-translating everything again.
 *
 * Falls back to returning the French text unchanged when no DEEPL_API_KEY is
 * set (local/dev default) or if the DeepL call still fails after a retry — a
 * disruption must never disappear from the UI just because its translation
 * isn't ready. A failed/fallback result is deliberately never cached, so the
 * next poll cycle (not just the next restart) gets another real attempt.
 */
export const translateToEnglish = async (frenchText: string): Promise<string> => {
  const cached = cache.get(frenchText);
  if (cached) return cached;

  const apiKey = config.deeplApiKey;
  if (!apiKey) {
    cache.set(frenchText, frenchText);
    persistCache();
    return frenchText;
  }

  try {
    await waitForCallSlot();
    let result = await attemptTranslation(frenchText, apiKey);
    if (!result.ok) {
      const waitMs = Math.min(result.retryAfterMs ?? 1500, 5000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      await waitForCallSlot();
      result = await attemptTranslation(frenchText, apiKey);
    }
    if (!result.ok) throw new Error("DeepL 429 (retried once, still rate-limited)");
    cache.set(frenchText, result.text);
    persistCache();
    return result.text;
  } catch (err) {
    console.error("[translate] DeepL call failed, falling back to French:", err);
    return frenchText;
  }
};
