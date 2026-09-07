import test from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "./translate.js";

test("chunkText returns single item array when text is below maxLen", () => {
  const shortText = "Trafic interrompu entre Paris et Versailles.";
  const chunks = chunkText(shortText, 450);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0], shortText);
});

test("chunkText splits text longer than maxLen along sentence boundaries without exceeding maxLen", () => {
  const s1 = "Période : le week-end à partir de 22h30. Dates : le dimanche 13/09.";
  const s2 = "Le trafic est interrompu entre Nanterre-la-Folie et Villiers-sur-Marne et entre Nanterre-la-Folie et Tournan.";
  const s3 = "Le dernier train NATU de Tournan vers Nanterre-la-Folie est à 21h53.";
  const s4 = "Le dernier train NOVY de Villiers-sur-Marne vers Nanterre-la-Folie est à 22h19.";
  const s5 = "Un service de bus de remplacement est mis en place avec desserte des gares intermédiaires.";

  const longText = [s1, s2, s3, s4, s5].join(" ");
  assert.ok(longText.length > 300);

  const chunks = chunkText(longText, 150);
  assert.ok(chunks.length > 1);

  for (const chunk of chunks) {
    assert.ok(chunk.length <= 150, `Chunk exceeds maxLen: ${chunk.length} > 150`);
  }

  // Verify all content is preserved
  for (const sentence of [s1, s2, s3, s4, s5]) {
    assert.ok(
      chunks.some((c) => c.includes(sentence) || sentence.includes(c)),
      `Missing sentence part in chunks: ${sentence}`
    );
  }
});

test("chunkText handles long sentences without punctuation by breaking on words", () => {
  const longSentence = "Word ".repeat(60).trim(); // 300 chars without punctuation
  const chunks = chunkText(longSentence, 100);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 100, `Chunk exceeds maxLen: ${chunk.length} > 100`);
  }
});
