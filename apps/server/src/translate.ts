const cache = new Map<string, string>();

/**
 * Translates French disruption text to English, once per distinct message.
 * Cached in memory for the process lifetime (see PRODUCT.md: cost scales with
 * distinct messages/day, not polls or visitors).
 *
 * Falls back to returning the French text unchanged when no DEEPL_API_KEY is
 * set (local/dev default) or if the DeepL call fails — a disruption must
 * never disappear from the UI just because its translation isn't ready.
 */
export async function translateToEnglish(frenchText: string): Promise<string> {
  const cached = cache.get(frenchText);
  if (cached) return cached;

  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    cache.set(frenchText, frenchText);
    return frenchText;
  }

  try {
    const res = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: [frenchText], source_lang: "FR", target_lang: "EN" }),
    });
    if (!res.ok) throw new Error(`DeepL ${res.status}`);
    const data = (await res.json()) as { translations: { text: string }[] };
    const english = data.translations[0]?.text ?? frenchText;
    cache.set(frenchText, english);
    return english;
  } catch (err) {
    console.error("[translate] DeepL call failed, falling back to French:", err);
    return frenchText;
  }
}
