import platforms from "../data/platforms.json";
import { chatgptAdapter } from "./chatgpt";
import { geminiAdapter } from "./gemini";
import type { Adapter, Capabilities, PlatformId } from "./types";

/**
 * Platform kaydı (karar K19): desteklenen tüm siteler tek listede.
 * Adresler ve yetenekler src/data/platforms.json dosyasında; burada yalnızca her kimliğin
 * adaptör koduyla eşleşmesi var. Yeni bir platform eklemek: adaptörü yaz, JSON'a satır ekle,
 * buraya kaydet, manifesti güncelle. registry.test.ts dördünün tutarlı olduğunu denetler.
 */

export interface PlatformEntry {
  platform: PlatformId;
  label: string;
  matches: string[];
  capabilities: Capabilities;
  adapter: Adapter;
}

const ADAPTERS: Partial<Record<PlatformId, Adapter>> = {
  chatgpt: chatgptAdapter,
  gemini: geminiAdapter,
};

type PlatformConfig = { label: string; matches: string[]; capabilities: Capabilities };

export const PLATFORMS: PlatformEntry[] = Object.entries(platforms.platforms as Record<string, PlatformConfig>).flatMap(
  ([id, cfg]) => {
    const adapter = ADAPTERS[id as PlatformId];
    return adapter ? [{ platform: id as PlatformId, label: cfg.label, matches: cfg.matches, capabilities: cfg.capabilities, adapter }] : [];
  },
);

/** Adrese uyan platform; tanınmayan sitede null (eklenti sessizce devre dışı kalır, K10). */
export function platformFor(url: URL): PlatformEntry | null {
  return PLATFORMS.find((p) => p.adapter.matches(url)) ?? null;
}
