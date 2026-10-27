import rules from "../data/personal-rules.json";
import { normalizeText } from "./text";

/**
 * Kişisel ve duygusal mesaj tespiti. İlke: bu sohbetlerde öneri gösterilmez.
 * Kurallar src/data/personal-rules.json dosyasında; Python tarafı (src/kafiai/personal.py)
 * aynı dosyayı okur ve tests/fixtures/personal_parity.json iki tarafı sınar.
 * Kurgu isteklerinde ("write a story") yalnızca kendine zarar ifadeleri sayılır.
 */

function variants(text: string): string[] {
  const raw = text ?? "";
  const tr = normalizeText(raw);
  const en = normalizeText(raw.replace(/I/g, "i"));
  return tr === en ? [` ${tr} `] : [` ${tr} `, ` ${en} `];
}

function hit(padded: string[], phrases: string[]): boolean {
  return padded.some((v) => phrases.some((p) => v.includes(` ${p} `)));
}

export function isPersonal(text: string): boolean {
  const v = variants(text);
  if (hit(v, rules.fiction_markers)) return hit(v, rules.fiction_exempt);
  return hit(v, rules.phrases);
}
