import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile, rename, mkdir } from "node:fs/promises";
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

// Fire-and-forget: debounced async disk write keeps translation responses and the Node
// event loop fast during bursts of new disruptions. Uses atomic rename so a partial write
// or abrupt restart never corrupts the existing cache file.
let persistTimer: NodeJS.Timeout | null = null;
let isWriting = false;
let pendingWriteAgain = false;

const flushCacheToDisk = async (): Promise<void> => {
  if (isWriting) {
    pendingWriteAgain = true;
    return;
  }
  isWriting = true;
  pendingWriteAgain = false;
  try {
    const dir = path.dirname(config.translateCachePath);
    await mkdir(dir, { recursive: true });
    const tmpPath = `${config.translateCachePath}.${Date.now()}.tmp`;
    const payload = JSON.stringify(Object.fromEntries(cache));
    await writeFile(tmpPath, payload, "utf-8");
    await rename(tmpPath, config.translateCachePath);
  } catch (err) {
    console.error("[translate] failed to persist cache asynchronously:", err);
  } finally {
    isWriting = false;
    if (pendingWriteAgain) {
      void flushCacheToDisk();
    }
  }
};

const flushSyncOnExit = () => {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    mkdirSync(path.dirname(config.translateCachePath), { recursive: true });
    writeFileSync(config.translateCachePath, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // Best-effort flush on shutdown
  }
};

process.on("beforeExit", flushSyncOnExit);
process.on("SIGINT", () => {
  flushSyncOnExit();
  process.exit(0);
});
process.on("SIGTERM", () => {
  flushSyncOnExit();
  process.exit(0);
});

const persistCache = () => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushCacheToDisk();
  }, 500);
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
let lastCallAt = 0;
let deeplDisabledUntil = 0;
let myMemoryDisabledUntil = 0;

const waitForCallSlot = async () => {
  const waitMs = config.translateMinCallIntervalMs - (Date.now() - lastCallAt);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastCallAt = Date.now();
};

/**
 * Attempts DeepL translation with a hard timeout and error classification.
 * Distinguishes permanent failures (quota 456, invalid auth 403) from transient 429s.
 */
const attemptTranslation = async (
  frenchText: string,
  apiKey: string
): Promise<{ ok: true; text: string } | { ok: false; retryAfterMs: number | null; permanent: boolean }> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(config.deeplUrl, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: [frenchText], source_lang: "FR", target_lang: "EN" }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (res.status === 456 || res.status === 403) {
      return { ok: false, retryAfterMs: null, permanent: true };
    }
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
      return { ok: false, retryAfterMs, permanent: false };
    }
    if (!res.ok) {
      return { ok: false, retryAfterMs: null, permanent: false };
    }
    const data = (await res.json()) as { translations?: { text: string }[] };
    return { ok: true, text: data.translations?.[0]?.text ?? frenchText };
  } catch {
    return { ok: false, retryAfterMs: null, permanent: false };
  }
};

/**
 * Splits long disruption text into sentence or clause chunks <= maxLen (default 450 chars).
 * Needed because MyMemory's free tier has a hard 500-character ceiling per query.
 */
export const chunkText = (text: string, maxLen = 450): string[] => {
  if (text.length <= maxLen) return [text];

  const sentences = text.split(/(?<=[.!?;:\n])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!sentence) continue;
    if (sentence.length > maxLen) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      const words = sentence.split(/\s+/);
      let wordChunk = "";
      for (const word of words) {
        if ((wordChunk + " " + word).trim().length <= maxLen) {
          wordChunk = (wordChunk + " " + word).trim();
        } else {
          if (wordChunk) chunks.push(wordChunk);
          wordChunk = word;
        }
      }
      if (wordChunk) chunks.push(wordChunk);
      continue;
    }

    if ((current ? current + " " + sentence : sentence).length <= maxLen) {
      current = current ? current + " " + sentence : sentence;
    } else {
      if (current) chunks.push(current.trim());
      current = sentence;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
};

/**
 * Translates a single text chunk (<= 450 characters) via MyMemory's free tier.
 * Only trips the 30-minute circuit breaker on true API exhaustion (quotaFinished or HTTP 429).
 */
const attemptMyMemorySingle = async (frenchText: string): Promise<string | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const url = `${config.myMemoryUrl}?q=${encodeURIComponent(frenchText)}&langpair=fr|en`;
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
    if (!res.ok) {
      if (res.status === 429) {
        myMemoryDisabledUntil = Date.now() + 30 * 60 * 1000;
        console.warn("[translate] MyMemory rate-limited (HTTP 429); pausing for 30 minutes");
      }
      return null;
    }
    const data = (await res.json()) as {
      responseStatus: number | string;
      quotaFinished?: boolean | null;
      responseData?: { translatedText?: string };
      responseDetails?: string;
    };
    if (data.quotaFinished || String(data.responseStatus) === "429") {
      myMemoryDisabledUntil = Date.now() + 30 * 60 * 1000;
      console.warn("[translate] MyMemory quota exhausted or rate-limited; pausing for 30 minutes");
      return null;
    }
    if (String(data.responseStatus) !== "200") {
      // Single query rejected (e.g. formatting or length); do not pause globally
      return null;
    }
    const text = data.responseData?.translatedText;
    return text ?? null;
  } catch {
    return null;
  }
};

/**
 * MyMemory free tier translation with sentence-level chunking and circuit breaker on quota exhaustion.
 */
const attemptMyMemoryTranslation = async (frenchText: string): Promise<string | null> => {
  const chunks = chunkText(frenchText, 450);
  if (chunks.length === 1) {
    return attemptMyMemorySingle(chunks[0]);
  }
  const translatedChunks: string[] = [];
  for (const chunk of chunks) {
    if (Date.now() < myMemoryDisabledUntil) return null;
    const res = await attemptMyMemorySingle(chunk);
    if (!res) return null;
    translatedChunks.push(res);
  }
  return translatedChunks.join(" ");
};

/**
 * Translates French disruption text to English, once per distinct message.
 * Cached on disk so a redeploy doesn't force re-translating everything again.
 *
 * Employs circuit breakers for both DeepL and MyMemory: if DeepL quota is exhausted
 * (HTTP 456) or key is invalid, DeepL is paused for 1 hour so the ingestion pipeline
 * never gets trapped in thousands of milliseconds of failing retries. If MyMemory
 * quota is hit or unavailable, it pauses for 30 minutes. When providers are disabled,
 * this function immediately and safely returns the original French text in 0ms.
 */
export const translateToEnglish = async (frenchText: string): Promise<string> => {
  if (!frenchText) return "";
  const cached = cache.get(frenchText);
  if (cached) return cached;

  const now = Date.now();
  const apiKey = config.deeplApiKey;

  if (apiKey && now >= deeplDisabledUntil) {
    try {
      await waitForCallSlot();
      let result = await attemptTranslation(frenchText, apiKey);
      if (!result.ok && !result.permanent) {
        const waitMs = Math.min(result.retryAfterMs ?? config.translateRetryDefaultMs, config.translateRetryMaxMs);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        await waitForCallSlot();
        result = await attemptTranslation(frenchText, apiKey);
      }
      if (result.ok) {
        cache.set(frenchText, result.text);
        persistCache();
        return result.text;
      } else if (result.permanent) {
        deeplDisabledUntil = Date.now() + 60 * 60 * 1000;
        console.warn("[translate] DeepL quota exhausted or key invalid; pausing DeepL for 1 hour");
      } else {
        deeplDisabledUntil = Date.now() + 5 * 60 * 1000;
        console.warn("[translate] DeepL rate-limited after retry; pausing DeepL for 5 minutes");
      }
    } catch (err) {
      deeplDisabledUntil = Date.now() + 5 * 60 * 1000;
      console.error("[translate] DeepL call error, pausing for 5 minutes:", err);
    }
  }

  if (now >= myMemoryDisabledUntil) {
    try {
      const fallback = await attemptMyMemoryTranslation(frenchText);
      if (fallback) {
        cache.set(frenchText, fallback);
        persistCache();
        return fallback;
      }
    } catch {
      myMemoryDisabledUntil = Date.now() + 15 * 60 * 1000;
    }
  }

  return frenchText;
};
