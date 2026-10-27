import { platformFor } from "../adapters/registry";
import { NAV_POLL_MS, POLL_MS } from "../config";
import { chromeStorage } from "../core/chrome-storage";
import {
  CounterStore,
  firstLenBucket,
  lenBucket,
  loopOutcome,
  slotOf,
  type Dims,
  type EventName,
  type Phase,
} from "../core/counters";
import { ExitCardPolicy } from "../core/exit-card-policy";
import { buildFreshStartDraft } from "../core/fresh-start";
import { HistoryWatcher } from "../core/history-watcher";
import { isPopupMessage, MSG_OPEN_CARD, type ConversationSnapshot } from "../core/messages";
import { isPersonal } from "../core/personal";
import { RepeatDetector } from "../core/repeat-detector";
import { Session } from "../core/session";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  PENDING_FRESH_KEY,
  SETTINGS_KEY,
  SettingsStore,
  type Settings,
} from "../core/settings";
import { taskNorm, taskType } from "../core/tasks";
import { turnFeatures } from "../core/turn-features";
import { MODEL_MIN_TURN, predict, type Prediction } from "../core/turn-model";
import { copyToClipboard } from "../ui/clipboard";
import { ExitCard } from "../ui/exit-card";
import { Strip } from "../ui/strip";

/** "Taze başlat" ile açılan yeni sohbetin tanınması için geçerlilik süresi. */
const FRESH_START_WINDOW_MS = 10 * 60 * 1000;

function main(): void {
  const url = new URL(location.href);
  const entry = platformFor(url);
  if (!entry) return; // tanımadığımız sitede sessizce devre dışı (K10)
  const { adapter, capabilities, platform } = entry;

  const session = new Session(adapter.conversationKey(url));
  const detector = new RepeatDetector(); // yalnızca bellekte; sohbet değişince silinir
  const strip = new Strip();
  const exitCard = new ExitCard();
  const policy = new ExitCardPolicy();
  const store = new SettingsStore(chromeStorage);
  const counters = new CounterStore(chromeStorage);
  // Bu sohbetteki kullanıcı mesajları: yalnızca bellekte, tur modelinin öznitelikleri ve sohbet
  // sonucu için. Sohbet değişince ya da sayfa kapanınca silinir; hiçbir yere yazılmaz.
  let userTexts: string[] = [];
  let lastPrediction: Prediction | null = null;
  /** Bu ziyarette kullanıcı en az bir mesaj gönderdi mi? (Yalnızca bakılan eski sohbetler sayılmaz.) */
  let sentThisVisit = false;
  /** Bu sohbet "Taze başlat" ile mi açıldı? */
  let freshFollowup = false;
  /** Sohbet kişisel ya da duygusal görünüyor mu? Öyleyse bu sohbette öneri gösterilmez. */
  let personal = false;
  /** Bu sohbette öncekine çok benzeyen mesaj sayısı ("Bu sohbet" bölümü için) */
  let similarCount = 0;

  // Ayarlar yüklenene kadar (null) eklenti hiçbir şey yapmaz.
  let settings: Settings | null = null;
  const active = () => settings?.enabled === true;
  /** Öneri gösterme açık mı? Kapalıyken ("yalnızca say") hiçbir şey bekletilmez ya da gösterilmez. */
  const suggesting = () => active() && settings?.suggestionsEnabled === true;
  /** Bu platformda öneri gösterilebilir mi (platform kaydı, K19)? */
  const intervening = () => capabilities.interventions === "full";
  const phase = (): Phase => (suggesting() ? "oneri" : "sayim");

  /** Sayaç boyutları: yalnızca kısa, sabit sözcükler (K18). Mesaj metni buraya girmez. */
  const dims = (extra: Dims = {}): Dims => ({
    platform,
    slot: slotOf(new Date()),
    task: userTexts[0] !== undefined ? taskType(userTexts[0]) : undefined,
    len: lenBucket(session.turns),
    ...extra,
  });
  const record = (event: EventName, detail: string, extra: Dims = {}) => counters.record(event, dims(extra), detail, phase());

  /** Sohbet bitti (başka sohbete geçildi ya da sekme kapandı): sonucu bir kez say. */
  const endConversation = () => {
    if (sentThisVisit && userTexts.length > 0) {
      const first = userTexts[0] ?? "";
      // Tur sayısı mesaj listesinden alınır: adres değişince oturum sayacı çoktan sıfırlanmış olur.
      record("conversation", loopOutcome(userTexts), { len: lenBucket(userTexts.length), first_len: firstLenBucket(first) });
      if (freshFollowup) record("fresh_followup", lenBucket(userTexts.length));
    }
    sentThisVisit = false;
    freshFollowup = false;
  };

  /** Cevap bitti: kart koşulu sağlanıyorsa, kullanıcı yazmaya başlamadan çıkış kartını göster. */
  const maybeShowExitCard = () => {
    if (strip.visible || exitCard.visible) return;
    const source = policy.triggerSource(session.turns);
    if (source === null) return;
    record("card", `tetiklendi_${source}`);
    // Kart modelin yüksek güvenli tahmininden geliyorsa gerekçesi ve önerisi gösterilir.
    const reason = source === "model" ? (lastPrediction?.reasons[0] ?? null) : null;
    const hide = (why: string) => {
      record("card", `gizlendi_${why}`);
      console.log(`[KafiAI] çıkış kartı gösterilmedi (${why}, tur ${session.turns})`);
    };
    if (policy.inCooldown(session.turns)) return hide("bekleme");
    if (!settings?.exitCardEnabled) return hide("kapali");
    if (!intervening()) return hide("platform");
    if (personal) {
      policy.dismissed(session.turns);
      return hide("kisisel");
    }
    if (!suggesting()) {
      // Aynı bekleme kuralı işlesin diye kapatılmış gibi say.
      policy.dismissed(session.turns);
      return hide("sayim");
    }
    const composer = adapter.composer();
    if (!composer || !composer.empty) return hide("yaziyor");
    showCard(source, reason, composer.anchor);
  };

  /** "Bu sohbet" bölümünden kart açılabilir mi? */
  const cardAvailable = () =>
    suggesting() && intervening() && !personal && userTexts.length > 0 && !strip.visible && !exitCard.visible && adapter.composer() !== null;

  /** Çıkış kartını gösterir: kendiliğinden (norm, model) ya da pencereden istenince (elle). */
  const showCard = (source: "norm" | "model" | "elle", reason: Prediction["reasons"][number] | null, anchor: Element) => {
    console.log(`[KafiAI] çıkış kartı gösterildi (tur ${session.turns}, ${source}${reason ? `: ${reason.key}` : ""})`);
    record("card", `gosterildi_${source}`);
    exitCard.show(
      anchor,
      session.turns,
      policy.norm,
      {
        getDraft: () => buildFreshStartDraft(adapter.readHistory()),
        onFreshStart: async (draft) => {
          const copied = await copyToClipboard(draft);
          if (copied) {
            // Yeni sohbet açılınca tanınabilsin diye yalnızca platform ve süre yazılır.
            void chromeStorage.set({ [PENDING_FRESH_KEY]: { platform, until: Date.now() + FRESH_START_WINDOW_MS } });
            window.open(adapter.newChatUrl(), "_blank", "noopener");
            record("card_action", "taze_baslat");
          }
          console.log(`[KafiAI] taze başlat: ${copied ? "panoya kopyalandı, yeni sohbet açıldı" : "kopyalanamadı"}`);
          return copied;
        },
        onNever: source === "elle" ? undefined : () => {
          console.log("[KafiAI] kullanıcı 'Bir daha gösterme' dedi");
          record("card_action", "bir_daha_gosterme");
          void store.update({ exitCardEnabled: false });
        },
        onDismiss: (kind) => {
          policy.dismissed(session.turns);
          // "taze": kopyalama başarılıyken zaten sayıldı; ikinci kez sayılmaz.
          if (kind === "ara") record("card_action", "ara");
          else if (kind === "kapat") record("card_action", "kapat");
          console.log(`[KafiAI] çıkış kartı kapandı (${kind})`);
        },
        onNotRelevant: () => {
          console.log("[KafiAI] kullanıcı model önerisi için 'Yerinde değildi' dedi");
          record("card_action", "yerinde_degil");
        },
      },
      reason,
    );
  };

  /** Tur modeli: kullanıcının o ana kadarki mesajlarından döngü olasılığı. Metin günlüğe yazılmaz. */
  const updatePrediction = (turns: number) => {
    if (capabilities.model !== "on" || userTexts.length < MODEL_MIN_TURN) return;
    lastPrediction = predict(turnFeatures(userTexts));
    policy.noteRisk(lastPrediction.level, turns);
    console.log(
      `[KafiAI] model: olasılık %${Math.round(lastPrediction.probability * 100)}, ${lastPrediction.level}, ` +
        `gerekçe ${lastPrediction.reasons.map((r) => r.key).join(", ")}`,
    );
  };

  /** Yeni boş bir sohbet "Taze başlat"tan mı geldi? İşaret bir kez kullanılır ve silinir. */
  const checkFreshStart = async () => {
    try {
      const stored = await chromeStorage.get([PENDING_FRESH_KEY]);
      const pending = stored[PENDING_FRESH_KEY] as { platform?: unknown; until?: unknown } | undefined;
      if (!pending) return;
      await chromeStorage.remove([PENDING_FRESH_KEY]);
      if (pending.platform === platform && typeof pending.until === "number" && pending.until >= Date.now()) {
        freshFollowup = true;
      }
    } catch {
      /* depolama okunamazsa yalnızca bu sayaç eksik kalır */
    }
  };

  const history = new HistoryWatcher(
    () => adapter.readHistory(),
    (texts) => {
      if (!active()) return;
      // Kullanıcı bu arada kendisi mesaj gönderdiyse karışmayalım.
      if (!session.seedTurns(texts.length)) return;
      // Geçmişteki mesajlar da canlı gönderim gibi işlenir: görev türü ilk mesajdan,
      // tekrar denemeleri sırayla karşılaştırarak (kalibrasyondaki simülasyonla aynı kural).
      if (texts[0] !== undefined) policy.setTask(taskType(texts[0]));
      for (const text of texts) {
        const check = detector.check(text);
        if (check.soft) policy.noteRepeat();
        if (check.similar) similarCount += 1;
        if (isPersonal(text)) personal = true;
        detector.remember(text);
      }
      userTexts = [...texts];
      console.log(`[KafiAI] sohbet geçmişi okundu: ${texts.length} kullanıcı mesajı`);
    },
  );
  const historyTimer = window.setInterval(() => history.tick(Date.now()), POLL_MS);
  let skipNextCheck = false; // onarım cümlesi eklendiyse, bir sonraki gönderimde tekrar sorma

  /** Ayarlar ilk kez yüklendi ya da değişti. */
  const applySettings = (next: Settings) => {
    const wasActive = active();
    const first = settings === null;
    settings = next;
    if (first) console.log(`[KafiAI] ayarlar: ${next.enabled ? "açık" : "kapalı"}, çıkış kartı ${next.exitCardEnabled ? "açık" : "kapalı"}`);
    if (first) console.log(`[KafiAI] öneriler: ${next.suggestionsEnabled ? "açık" : "kapalı (yalnızca say)"}`);
    if (!next.enabled || !next.suggestionsEnabled) {
      strip.hide();
      exitCard.hide();
    }
    if (!next.enabled) {
      history.cancel();
      skipNextCheck = false;
      if (wasActive) console.log("[KafiAI] eklenti kapatıldı");
      return;
    }
    if (!wasActive) {
      // Yeni açıldı (ya da sayfa yeni yüklendi): kapalıyken sayım yapılmadı, baştan başla.
      session.restart();
      detector.reset();
      policy.reset();
      userTexts = [];
      lastPrediction = null;
      sentThisVisit = false;
      personal = false;
      similarCount = 0;
      if (session.key !== null) history.begin(Date.now());
      else void checkFreshStart();
      if (!first) console.log("[KafiAI] eklenti açıldı");
    }
  };
  store
    .load()
    .then(applySettings)
    .catch(() => applySettings(DEFAULT_SETTINGS));
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[SETTINGS_KEY];
    if (area === "local" && change) applySettings(parseSettings(change.newValue));
  });

  // Mesaj metni hiçbir zaman günlüğe yazılmaz; yalnızca uzunluğu.
  const stop = adapter.start({
    onBeforeSend: ({ text, anchor }) => {
      if (!active()) return false;
      const check = detector.check(text);
      if (!check.similar) {
        skipNextCheck = false;
        return false;
      }
      record("strip", "tetiklendi");
      if (skipNextCheck) {
        // Onarım cümlesi az önce eklendi: aynı mesaj için tekrar sorulmaz.
        skipNextCheck = false;
        record("strip", "gizlendi_bekleme");
        return false;
      }
      if (!intervening()) {
        record("strip", "gizlendi_platform");
        return false;
      }
      if (personal || isPersonal(text)) {
        record("strip", "gizlendi_kisisel"); // kişisel ya da duygusal sohbet: araya girme
        return false;
      }
      if (!suggesting()) {
        record("strip", "gizlendi_sayim"); // yalnızca say: mesaja dokunma
        return false;
      }
      console.log(`[KafiAI] benzer mesaj, gönderim bekletildi (skor ${check.score.toFixed(2)})`);
      record("strip", "gosterildi");
      exitCard.hide();
      strip.show(anchor, {
        onSendAnyway: () => {
          console.log("[KafiAI] kullanıcı 'Yine de gönder' dedi");
          record("strip_action", "yine_de_gonder");
          adapter.submitHeld();
        },
        onNotRelevant: () => {
          console.log("[KafiAI] kullanıcı 'Yerinde değildi' dedi");
          record("strip_action", "yerinde_degil");
          adapter.submitHeld();
        },
        onClose: () => {
          console.log("[KafiAI] kullanıcı düzenlemeye döndü");
          record("strip_action", "duzenle");
          adapter.focusComposer();
        },
        onRepair: (sentence, id) => {
          const ok = adapter.insertText(sentence);
          skipNextCheck = ok;
          if (ok) record("repair_button", id);
          console.log(`[KafiAI] onarım cümlesi eklendi: ${ok ? "evet" : "HAYIR (eklenemedi)"}`);
        },
      });
      return true;
    },
    onSend: ({ text }) => {
      if (!active()) return;
      history.cancel();
      strip.hide();
      const n = session.recordSend();
      sentThisVisit = true;
      if (n === 1) policy.setTask(taskType(text));
      if (exitCard.visible) {
        exitCard.hide(); // kartı yok sayıp yazmaya devam etti
        policy.dismissed(n);
        record("card_action", "kapat");
      }
      const check = detector.check(text);
      detector.remember(text);
      userTexts.push(text);
      if (check.similar) similarCount += 1;
      if (!personal && isPersonal(text)) {
        personal = true;
        exitCard.hide();
        console.log("[KafiAI] sohbet kişisel görünüyor; bu sohbette öneri gösterilmeyecek");
      }
      // Çıkış kartı için tekrar denemesi: farklı kelimelerle yapılanlar da sayılır (yumuşak eşik).
      // Öneriler açık da kapalı da olsa aynı kural işler; böylece iki mod karşılaştırılabilir.
      if (check.soft) policy.noteRepeat();
      record("send", check.tooShort ? "kisa" : check.similar ? "benzer" : "farkli");
      updatePrediction(n);

      const verdict = check.tooShort ? "kısa, bakılmadı" : check.similar ? "BENZER" : "farklı";
      console.log(
        `[KafiAI] mesaj gönderildi: ${text.length} karakter, oturumda ${n}. mesaj, ${verdict} (skor ${check.score.toFixed(2)})`,
      );
    },
    onResponseComplete: () => {
      if (!active()) return;
      console.log("[KafiAI] cevap bitti");
      maybeShowExitCard();
    },
    onNoSignal: () => {
      if (!active()) return;
      console.log("[KafiAI] cevap sinyali görülmedi (sayfa yapısı değişmiş olabilir)");
    },
    onRegenerate: () => {
      if (active()) record("regenerate", "-");
    },
    onEdit: () => {
      if (active()) record("edit", "-");
    },
  });

  // Tek sayfalık uygulama: adres değişince sohbetin değişip değişmediğine bak.
  // Günlükte kimlikler maskelenir (ilk 4 karakter): "/c/68f8…"
  const mask = (href: string) =>
    new URL(href).pathname.replace(/[A-Za-z0-9-]{8,}/g, (m) => m.slice(0, 4) + "…");

  let lastHref = location.href;
  const navTimer = window.setInterval(() => {
    if (location.href === lastHref) return;
    const previous = lastHref;
    lastHref = location.href;
    const nextKey = adapter.conversationKey(new URL(location.href));
    const result = session.onNavigate(nextKey);
    if (result === "reset") {
      endConversation(); // önceki sohbetin sonucu, durum sıfırlanmadan önce
      detector.reset();
      strip.hide();
      exitCard.hide();
      policy.reset();
      userTexts = [];
      lastPrediction = null;
      personal = false;
      similarCount = 0;
      history.cancel();
      if (active() && session.key !== null) history.begin(Date.now()); // başka bir var olan sohbet açıldı
      else if (active()) void checkFreshStart();
    }
    if (active()) {
      console.log(`[KafiAI] sohbet adresi değişti: ${result} (${mask(previous)} → ${mask(location.href)})`);
    }
  }, NAV_POLL_MS);

  // Araç çubuğu penceresinden gelen istekler. Cevapta mesaj metni yok; yalnızca sayılar.
  const snapshot = (): ConversationSnapshot => {
    const task = userTexts[0] !== undefined ? taskType(userTexts[0]) : null;
    const norm = task !== null ? taskNorm(task) : null;
    return {
      platform,
      active: active(),
      suggesting: suggesting(),
      intervening: intervening(),
      personal,
      turns: userTexts.length,
      task,
      similar: similarCount,
      norm: norm && task !== "diger" ? { median: norm.median_turns, p75: norm.p75_turns } : null,
      card_available: cardAvailable(),
    };
  };
  const onPopupMessage = (message: unknown, _sender: unknown, respond: (r: unknown) => void) => {
    if (!isPopupMessage(message)) return false;
    if (message.type === MSG_OPEN_CARD) {
      const composer = adapter.composer();
      const ok = cardAvailable() && composer !== null;
      if (ok) showCard("elle", null, composer.anchor);
      respond({ ok });
      return false;
    }
    respond(snapshot());
    return false;
  };
  chrome.runtime.onMessage.addListener(onPopupMessage);

  window.addEventListener("pagehide", () => {
    chrome.runtime.onMessage.removeListener(onPopupMessage);
    endConversation();
    void counters.flush();
    stop();
    window.clearInterval(navTimer);
    window.clearInterval(historyTimer);
  });
  // Sekme arka plana geçince biriken sayaçlar yazılır (sekme sonra kapatılabilir).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void counters.flush();
  });

  console.log(`[KafiAI] ${adapter.name} adaptörü hazır`);
}

main();
