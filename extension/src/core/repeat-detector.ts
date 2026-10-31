import { MIN_NORMALIZED_CHARS, RECENT_MESSAGES, SIMILARITY_THRESHOLD, SOFT_SIMILARITY_THRESHOLD } from "../config";
import rules from "../data/repeat-rules.json";
import { ngramVector, cosine } from "./similarity";
import { normalizeText } from "./text";

export interface RepeatCheck {
  /** Bu mesaj, yakın zamanda gönderilen birinin neredeyse aynısı mı? (şerit çıkar) */
  similar: boolean;
  /** Farklı kelimelerle de olsa aynı talebe benziyor mu? (yalnızca çıkış kartı için sayılır) */
  soft: boolean;
  /** En yüksek benzerlik (0..1); karşılaştırılamadıysa 0. */
  score: number;
  /** Karşılaştırılamayan kısa mesaj mı? */
  tooShort: boolean;
  /** Benzerlik eşiği geçti ama yeni bir içerik kelimesi var (seri iş ya da yeni istek); şerit çıkmaz. */
  newContent: boolean;
}

interface Remembered {
  vec: Map<number, number>;
  tokens: Set<string>;
  stems: Set<string>;
}

const FILLER = new Set<string>(rules.filler);
const hasDigit = (t: string) => /\p{N}/u.test(t);
const STEM = rules.stem_chars;

function remembered(normalized: string): Remembered {
  const tokens = normalized.split(" ").filter((t) => t !== "");
  return {
    vec: ngramVector(normalized),
    tokens: new Set(tokens),
    stems: new Set(tokens.filter((t) => Array.from(t).length >= STEM && !hasDigit(t)).map((t) => Array.from(t).slice(0, STEM).join(""))),
  };
}

/** Yeni mesajın öncekinde karşılığı olmayan içerik kelimeleri (Python: extension_similarity.new_content). */
export function newContent(normalizedNew: string, previous: Remembered): string[] {
  const out: string[] = [];
  for (const t of normalizedNew.split(" ")) {
    if (t === "" || FILLER.has(t)) continue;
    const chars = Array.from(t);
    if (chars.length < rules.min_token_chars && !hasDigit(t)) continue;
    if (previous.tokens.has(t)) continue;
    if (!hasDigit(t) && chars.length >= STEM && previous.stems.has(chars.slice(0, STEM).join(""))) continue;
    out.push(t);
  }
  return out;
}

/**
 * Oturumdaki son kullanıcı mesajlarını yalnızca bellekte tutar (sayfa kapanınca/sohbet
 * değişince silinir, hiçbir yere yazılmaz) ve yeni mesajın benzer olup olmadığına bakar.
 * Şerit için iki koşul: 3-gram benzerliği eşiği geçer ve yeni mesaj yeni bir içerik kelimesi
 * getirmez ("1. soruyu çöz" / "2. soruyu çöz" gibi seri işler tekrar sayılmaz; src/data/repeat-rules.json).
 */
export class RepeatDetector {
  private recent: Remembered[] = [];

  /** Mesaj gönderilmeden önce çağrılır; mesajı listeye eklemez. */
  check(text: string): RepeatCheck {
    const normalized = normalizeText(text);
    if (Array.from(normalized).length < MIN_NORMALIZED_CHARS) {
      return { similar: false, soft: false, score: 0, tooShort: true, newContent: false };
    }
    const vec = ngramVector(normalized);
    let score = 0;
    let similar = false;
    let aboveThreshold = false;
    for (const previous of this.recent) {
      const s = cosine(vec, previous.vec);
      score = Math.max(score, s);
      if (s >= SIMILARITY_THRESHOLD) {
        aboveThreshold = true;
        if (newContent(normalized, previous).length === 0) similar = true;
      }
    }
    return { similar, soft: score >= SOFT_SIMILARITY_THRESHOLD, score, tooShort: false, newContent: aboveThreshold && !similar };
  }

  /** Mesaj gönderildikten sonra çağrılır. Kısa mesajlar saklanmaz. */
  remember(text: string): void {
    const normalized = normalizeText(text);
    if (Array.from(normalized).length < MIN_NORMALIZED_CHARS) return;
    this.recent.push(remembered(normalized));
    if (this.recent.length > RECENT_MESSAGES) this.recent.shift();
  }

  reset(): void {
    this.recent = [];
  }
}

export { remembered as rememberForTest };
