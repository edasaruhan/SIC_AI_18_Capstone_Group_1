/** Kullanıcının gönderdiği mesaj. Metin yalnızca bellekte tutulur, hiçbir yere yazılmaz. */
export interface SendInfo {
  text: string;
}

/** Mesaj gönderilmeden hemen önce: bekletilip bekletilmeyeceğine karar vermek için. */
export interface BeforeSendInfo {
  text: string;
  /** Mesaj kutusunun bulunduğu öğe; arayüzü bunun yakınına yerleştirmek için. */
  anchor: Element;
}

/** Desteklenen platformların kimlikleri; sayaç şemasıyla aynı liste (src/data/counter-schema.json). */
export type PlatformId = "chatgpt" | "gemini" | "claude" | "copilot" | "google_ai_mode";

/** Platformun yetenekleri (src/data/platforms.json, karar K19). */
export interface Capabilities {
  /** Adaptör "yeniden üret" eylemini yakalayabiliyor mu? */
  regenerate: boolean;
  /** Adaptör kullanıcının mesajını düzenlemesini yakalayabiliyor mu? */
  edit: boolean;
  /** Tur modeli bu platformda çalışsın mı? */
  model: "on" | "off";
  /** full: şerit ve kart gösterilir; count_only: yalnızca sayılır. */
  interventions: "full" | "count_only";
}

export interface AdapterHandlers {
  /**
   * Gönderme girişimi yakalandı, henüz gönderilmedi. true dönerse gönderim bekletilir
   * (adapter olayı durdurur); sonra submitHeld() ile gönderilebilir. Yoksa mesaj normal gider.
   */
  onBeforeSend?(info: BeforeSendInfo): boolean;
  /** Kullanıcı bir mesaj gönderdi. */
  onSend(info: SendInfo): void;
  /** Yapay zekanın cevabı bitti. */
  onResponseComplete(): void;
  /** Mesaj gönderildi ama "üretiliyor" sinyali hiç görülmedi (sayfa yapısı değişmiş olabilir). */
  onNoSignal(): void;
  /** Kullanıcı cevabı yeniden ürettirdi (yalnızca capabilities.regenerate olan adaptörler çağırır). */
  onRegenerate?(): void;
  /** Kullanıcı önceki bir mesajını düzenledi (yalnızca capabilities.edit olan adaptörler çağırır). */
  onEdit?(): void;
}

/** Her yapay zeka sitesi için sayfa yapısını bilen küçük bir katman. */
export interface Adapter {
  readonly name: string;
  /** Platform kimliği; sayaçlarda boyut olarak kullanılır. */
  readonly platform: PlatformId;
  matches(url: URL): boolean;
  /** Sayfadaki sohbeti anahtarlayan kimlik. Yeni (henüz kaydedilmemiş) sohbette null. */
  conversationKey(url: URL): string | null;
  /** İzlemeyi başlatır; durdurmak için dönen fonksiyonu çağır. */
  start(handlers: AdapterHandlers): () => void;
  /** Bekletilen mesajı olduğu gibi gönderir. Bekleyen yoksa false döner. */
  submitHeld(): boolean;
  /** Metni mesaj kutusunun sonuna, yeni bir satır olarak ekler. Başarılıysa true. */
  insertText(text: string): boolean;
  /** Sayfada görünen önceki kullanıcı mesajlarının metinleri (eskiden yeniye). Yalnızca bellekte kullanılır. */
  readHistory(): string[];
  /** Yeni (boş) bir sohbetin adresi. */
  newChatUrl(): string;
  /** Mesaj kutusu: arayüzü yerleştirmek için çapa ve kutunun boş olup olmadığı. Kutu yoksa null. */
  composer(): { anchor: Element; empty: boolean } | null;
  /** Mesaj kutusuna odaklanır. */
  focusComposer(): void;
}
