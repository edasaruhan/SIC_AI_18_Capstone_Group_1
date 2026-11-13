import { platformFor } from "../adapters/registry";
import { BLANK_AFTER_SEND_MS, BLANK_TICKS, NAV_POLL_MS, POLL_MS } from "../config";
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
import { HistoryWatcher, historySeed, historySignature } from "../core/history-watcher";
import { isPopupMessage, MSG_OPEN_CARD, type ConversationSnapshot } from "../core/messages";
import { isPersonal } from "../core/personal";
import { ringLevel, ringText } from "../core/ring";
import { ConversationSignals, isShortRepair } from "../core/signals";
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
import { taskNorm, taskType, type TaskType } from "../core/tasks";
import { EXACT_REPEAT_THRESHOLD, turnFeatures } from "../core/turn-features";
import { MODEL_MIN_TURN, predict, reasonByKey, type Prediction } from "../core/turn-model";
import { copyToClipboard } from "../ui/clipboard";
import { ExitCard } from "../ui/exit-card";
import { Ring } from "../ui/ring";
import { Strip } from "../ui/strip";

/** "Taze başlat" ile açılan yeni sohbetin tanınması için geçerlilik süresi. */
const FRESH_START_WINDOW_MS = 10 * 60 * 1000;

/** true: bu sayfada bir platform bulundu ve eklenti başladı. */
function main(): boolean {
  const url = new URL(location.href);
  const entry = platformFor(url);
  if (!entry) return false; // tanımadığımız sitede sessizce devre dışı (K10)
  const { adapter, capabilities, platform } = entry;

  const session = new Session(adapter.conversationKey(url));
  const detector = new RepeatDetector(); // yalnızca bellekte; sohbet değişince silinir
  // Sohbet sinyalleri (K32): özür döngüsü, döngüden çıkış, belirsiz istek, konu kayması. Yalnızca bellekte.
  const signals = new ConversationSignals();
  /** Bu sohbette sayılmış sinyaller: her biri sohbet başına bir kez sayılır (yalnızca bellekte). */
  const seenSignals = new Set<string>();
  const strip = new Strip();
  const exitCard = new ExitCard();
  const ring = new Ring();
  const policy = new ExitCardPolicy();
  const store = new SettingsStore(chromeStorage);
  const counters = new CounterStore(chromeStorage);
  // Bu sohbetteki kullanıcı mesajları: yalnızca bellekte, tur modelinin öznitelikleri ve sohbet
  // sonucu için. Sohbet değişince ya da sayfa kapanınca silinir; hiçbir yere yazılmaz.
  let userTexts: string[] = [];
  /**
   * Açılan sohbette sayfada çizilmediği için okunamayan eski mesaj sayısı (sanal liste, Claude).
   * Sıfırdan büyükse ilk mesaj bilinmez: görev türü ve tur modeli bu sohbette kullanılmaz,
   * tur sayısı yine doğru tutulur.
   */
  let hiddenTurns = 0;
  /** Görev türü ilk mesajdan çıkarılır; ilk mesaj okunamadıysa bilinmez. */
  const currentTask = (): TaskType | null =>
    hiddenTurns === 0 && userTexts[0] !== undefined ? taskType(userTexts[0]) : null;
  let lastPrediction: Prediction | null = null;
  /** Bu ziyarette kullanıcı en az bir mesaj gönderdi mi? (Yalnızca bakılan eski sohbetler sayılmaz.) */
  let sentThisVisit = false;
  /** Bu sohbet "Taze başlat" ile mi açıldı? */
  let freshFollowup = false;
  /** Sohbet kişisel ya da duygusal görünüyor mu? Öyleyse bu sohbette öneri gösterilmez. */
  let personal = false;
  /** Bu sohbette öncekine çok benzeyen mesaj sayısı ("Bu sohbet" bölümü için) */
  let similarCount = 0;
  /** Bu sohbette halkanın ulaştığı en yüksek seviye (sayaç tekrarını önlemek için) */
  let ringPeak = 0;
  let ringExplained = false;
  /** Konsola yazılan son halka seviyesi; elle doğrulamada seviye değişimini tek satırda görmek için */
  let ringLogged = 0;

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
    task: currentTask() ?? undefined,
    len: lenBucket(session.turns),
    ...extra,
  });
  const record = (event: EventName, detail: string, extra: Dims = {}) => counters.record(event, dims(extra), detail, phase());

  /** Sohbet bitti (başka sohbete geçildi ya da sekme kapandı): sonucu bir kez say. */
  const endConversation = () => {
    if (sentThisVisit && userTexts.length > 0) {
      // Tur sayısı mesaj listesinden alınır: adres değişince oturum sayacı çoktan sıfırlanmış olur.
      const turns = userTexts.length + hiddenTurns;
      const extra: Dims = { len: lenBucket(turns) };
      if (hiddenTurns === 0) extra.first_len = firstLenBucket(userTexts[0] ?? "");
      record("conversation", loopOutcome(userTexts), extra);
      if (freshFollowup) record("fresh_followup", lenBucket(turns));
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
    const reason =
      source === "model" ? (lastPrediction?.reasons[0] ?? null) : source === "ozur" ? reasonByKey("ozur") : null;
    const hide = (why: string) => {
      record("card", `gizlendi_${why}`);
      console.log(`[KafiAI] çıkış kartı gösterilmedi (${why}, tur ${session.turns})`);
    };
    if (policy.inCooldown(session.turns)) return hide("bekleme");
    // Bu turda şerit zaten araya girdi; kart bekleme süresi başlatmadan bir sonraki tura kalır.
    if (policy.stripShownThisTurn(session.turns)) return hide("serit");
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
  const showCard = (source: "norm" | "model" | "ozur" | "elle", reason: Prediction["reasons"][number] | null, anchor: Element) => {
    console.log(`[KafiAI] çıkış kartı gösterildi (tur ${session.turns}, ${source}${reason ? `: ${reason.key}` : ""})`);
    record("card", `gosterildi_${source}`);
    ring.hide();
    exitCard.show(
      anchor,
      session.turns,
      policy.norm,
      {
        // Bellekteki liste, sayfadan okunandan uzunsa onu kullan: sanal liste kullanan sitelerde
        // eski mesajlar kaydırınca sayfadan kalkar ama bu ziyarette gönderilenler bellekte durur.
        getDraft: () => {
          const onPage = adapter.readHistory();
          // Sohbet başka bir konuya kaydıysa taslağa yalnızca şu anki konunun istekleri girer (K32).
          const own = signals.segments > 1 ? userTexts.slice(signals.segmentStart) : userTexts;
          return buildFreshStartDraft(userTexts.length >= onPage.length ? own : onPage);
        },
        focusedDraft: () => signals.segments > 1 && userTexts.length >= adapter.readHistory().length,
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
          if (kind !== "taze") adapter.focusComposer(); // kart kapanınca odak mesaj kutusuna döner
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
    // Geçmişin bir kısmı okunamadıysa öznitelikler eksik kalır; model bu sohbette çalışmaz.
    if (capabilities.model !== "on" || hiddenTurns > 0 || userTexts.length < MODEL_MIN_TURN) return;
    lastPrediction = predict(turnFeatures(userTexts));
    // Kullanıcı az önce döngüden çıktığını söylediyse (teşekkür, "oldu") model kartı açmaz.
    if (!signals.exited) policy.noteRisk(lastPrediction.level, turns);
    console.log(
      `[KafiAI] model: olasılık %${Math.round(lastPrediction.probability * 100)}, ${lastPrediction.level}, ` +
        `gerekçe ${lastPrediction.reasons.map((r) => r.key).join(", ")}`,
    );
  };

  /**
   * Halka (K29): yalnızca öneriler açıkken, bu platformda öneri gösterilebiliyorken, sohbet kişisel
   * değilken ve ayarı açıkken görünür. Şerit ya da kart açıkken üst üste binmesin diye gizlenir.
   */
  const updateRing = () => {
    const composer = adapter.composer();
    const allowed = suggesting() && intervening() && !personal && settings?.ringEnabled === true && userTexts.length > 0;
    if (!allowed || !composer || strip.visible || exitCard.visible) {
      ring.hide();
      return;
    }
    const ringSignals = {
      prediction: signals.exited ? null : lastPrediction,
      similarCount: signals.recentSimilar,
      apologyStreak: signals.apologyStreak,
      vagueStreak: signals.vagueStreak,
      shortRepeatStreak: signals.shortRepeatStreak,
      shortRepair: signals.shortRepair,
    };
    const level = ringLevel(ringSignals);
    if (level !== ringLogged) {
      // Yalnızca sayılar yazılır; mesaj metni günlüğe girmez.
      console.log(
        `[KafiAI] halka: seviye ${ringLogged} → ${level} (benzer ${ringSignals.similarCount}, özür ${ringSignals.apologyStreak}, ` +
          `belirsiz ${ringSignals.vagueStreak}, kısa tekrar ${ringSignals.shortRepeatStreak}, ` +
          `kısa onarım ${ringSignals.shortRepair ? "evet" : "hayır"}, model ${ringSignals.prediction?.level ?? "yok"})`,
      );
      ringLogged = level;
    }
    ring.update(composer.anchor, level, ringText(ringSignals), () => {
      if (ringExplained) return;
      ringExplained = true;
      record("ring", "aciklama");
    });
    // Halka şerit ya da kart yüzünden gizlenip yeniden çizilse de her seviye sohbet başına bir kez sayılır.
    if (level > ringPeak) {
      ringPeak = level;
      record("ring", `yukseldi_${level}`);
    }
  };

  /**
   * Kullanıcı mesajını sohbet sinyallerine işler. Kullanıcı döngüden çıktıysa ya da konu değiştiyse
   * o ana kadarki benzer mesaj denemeleri çıkış kartını artık açtırmaz.
   */
  const recordSignal = (detail: "ozur_dongusu" | "cikis" | "konu_kaymasi" | "belirsiz") => {
    // Yalnızca bu ziyarette yazılan sohbetler sayılır; eski bir sohbete bakmak sayılmaz.
    if (!sentThisVisit || seenSignals.has(detail)) return;
    seenSignals.add(detail);
    record("signal", detail);
  };

  const noteUserSignals = (text: string, similar: boolean) => {
    const segmentsBefore = signals.segments;
    const loopBefore = signals.recentSimilar > 0 || signals.apologyStreak > 0 || signals.vagueStreak >= 2;
    signals.noteUser(text, { similar });
    if (signals.exited && loopBefore) recordSignal("cikis");
    if (signals.segments > segmentsBefore) recordSignal("konu_kaymasi");
    if (signals.vagueStreak >= 2) recordSignal("belirsiz");
    policy.setRepeats(signals.recentSimilar);
    if (signals.exited || signals.segments > segmentsBefore) {
      policy.clearRepeats();
      console.log(`[KafiAI] ${signals.exited ? "döngüden çıkış mesajı" : "yeni konu"}: halka ve kart sinyalleri sıfırlandı`);
    }
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

  // Sohbet değişince sayfada kalan önceki sohbetin mesajları (bkz. resetConversation).
  let staleHistory: string | null = null;
  let emptyTicks = 0;
  let lastSendAt = 0;
  const readFreshHistory = (): string[] => {
    const texts = adapter.readHistory();
    if (staleHistory !== null && texts.length > 0) {
      if (historySignature(texts) === staleHistory) return [];
      staleHistory = null; // sayfa yeni sohbete geçti
    }
    return texts;
  };
  /**
   * Kaydedilmemiş bir sohbette (adres anahtarı yok: geçici sohbet ya da ilk mesaj öncesi)
   * kullanıcı yeni sohbet açınca adres değişmeyebilir. Mesaj gönderilmiş ama sayfada birkaç
   * ölçüm boyunca hiç kullanıcı mesajı yoksa sohbet değişmiş sayılır.
   */
  const blankedInPlace = (): boolean => {
    if (session.key !== null || session.turns === 0 || Date.now() - lastSendAt < BLANK_AFTER_SEND_MS) {
      emptyTicks = 0;
      return false;
    }
    emptyTicks = adapter.readHistory().length === 0 ? emptyTicks + 1 : 0;
    return emptyTicks >= BLANK_TICKS;
  };
  const history = new HistoryWatcher(
    readFreshHistory,
    (texts) => {
      if (!active()) return;
      // Kullanıcı bu arada kendisi mesaj gönderdiyse karışmayalım.
      const seed = historySeed(texts, adapter.historyTotal?.());
      if (!session.seedTurns(seed.turns)) return;
      hiddenTurns = seed.hidden;
      // Geçmişteki mesajlar da canlı gönderim gibi işlenir: görev türü ilk mesajdan,
      // tekrar denemeleri sırayla karşılaştırarak (kalibrasyondaki simülasyonla aynı kural).
      // İlk mesaj okunamadıysa görev türü bilinmez; kart genel normla çalışır.
      if (texts[0] !== undefined && !seed.partial) policy.setTask(taskType(texts[0]));
      for (const text of texts) {
        const check = detector.check(text);
        if (check.similar) similarCount += 1;
        noteUserSignals(text, check.similar);
        if (isPersonal(text)) personal = true;
        detector.remember(text);
      }
      userTexts = [...texts];
      if (!seed.partial && texts.length >= MODEL_MIN_TURN && capabilities.model === "on") {
        lastPrediction = predict(turnFeatures(userTexts));
      }
      updateRing();
      console.log(
        seed.partial
          ? `[KafiAI] sohbet geçmişi okundu: ${seed.turns} kullanıcı mesajından ${texts.length} tanesi sayfada`
          : `[KafiAI] sohbet geçmişi okundu: ${texts.length} kullanıcı mesajı`,
      );
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
    if (!next.enabled || !next.suggestionsEnabled || !next.ringEnabled) ring.hide();
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
      signals.reset();
      seenSignals.clear();
      policy.reset();
      userTexts = [];
      hiddenTurns = 0;
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
      // Kısa onarım ("olmadı", "yanlış"): tekrar değil ama neyin olmadığını söylemiyor.
      // İlk mesajda anlamı yok; önce bir cevap gelmiş olmalı.
      const shortRepair = !check.similar && session.turns > 0 && isShortRepair(text);
      // Birebir olmayan yeniden yazımda gönderim bekletilmez; halka ve kart yine de sayar.
      if (!check.hold && !shortRepair) {
        skipNextCheck = false;
        return false;
      }
      record("strip", shortRepair ? "tetiklendi_kisa" : "tetiklendi");
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
      console.log(
        shortRepair
          ? "[KafiAI] kısa onarım mesajı, gönderim bekletildi"
          : `[KafiAI] benzer mesaj, gönderim bekletildi (skor ${check.score.toFixed(2)})`,
      );
      record("strip", shortRepair ? "gosterildi_kisa" : "gosterildi");
      policy.noteStrip(session.turns + 1); // mesaj gönderilince bu tur numarasını alacak
      exitCard.hide();
      const task = currentTask();
      const stripContext = {
        // Kısa onarımda önceki denemeler, tekrarda yalnızca bu mesajın kendi tekrarları sayılır.
        attempt: shortRepair ? signals.recentSimilar + 1 : check.matches + 1,
        exact: check.score >= EXACT_REPEAT_THRESHOLD,
        task,
        kind: shortRepair ? ("short_repair" as const) : ("repeat" as const),
      };
      ring.hide();
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
        onFreshStart: () => {
          console.log("[KafiAI] kullanıcı şeritten 'Yeni sohbete geç' dedi");
          record("strip_action", "yeni_sohbet");
          const composer = adapter.composer();
          if (composer) showCard("elle", null, composer.anchor);
        },
        onRepair: (sentence, id) => {
          const ok = adapter.insertText(sentence);
          skipNextCheck = ok;
          if (ok) record("repair_button", id);
          console.log(`[KafiAI] onarım cümlesi eklendi: ${ok ? "evet" : "HAYIR (eklenemedi)"}`);
        },
      }, stripContext);
      return true;
    },
    onSend: ({ text }) => {
      if (!active()) return;
      history.cancel();
      staleHistory = null;
      lastSendAt = Date.now();
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
      // Çıkış kartı için döngü işareti: son dört mesajdaki benzer mesajlar (K33). Öneriler açık da
      // kapalı da olsa aynı kural işler; böylece iki mod karşılaştırılabilir.
      noteUserSignals(text, check.similar);
      const shortRepair = signals.shortRepair;
      record(
        "send",
        shortRepair ? "kisa_onarim" : check.tooShort ? "kisa" : check.similar ? "benzer" : check.variation ? "varyasyon" : "farkli",
      );
      updatePrediction(n);
      updateRing();

      const verdict = shortRepair
        ? "KISA ONARIM (tekrar denemesi sayıldı)"
        : check.tooShort
          ? `kısa, karşılaştırılmadı${signals.shortRepeatStreak > 1 ? ` (aynı kısa mesaj üst üste ${signals.shortRepeatStreak}. kez)` : ""}`
          : check.similar
            ? check.hold
              ? "BENZER"
              : "benzer yeniden yazım (bekletilmedi, halka ve kart için sayıldı)"
            : check.variation
              ? "varyasyon isteği"
              : "farklı";
      console.log(
        `[KafiAI] mesaj gönderildi: ${text.length} karakter, oturumda ${n}. mesaj, ${verdict} (skor ${check.score.toFixed(2)})`,
      );
    },
    onResponseComplete: () => {
      if (!active()) return;
      console.log("[KafiAI] cevap bitti");
      // Cevabın yalnızca başı, yalnızca bellekte ve yalnızca özür kuralı için okunur (K32).
      signals.noteAnswer(adapter.lastResponse?.() ?? null);
      if (signals.apologyStreak > 0) console.log(`[KafiAI] cevap özürle başladı (üst üste ${signals.apologyStreak})`);
      policy.noteApologies(signals.apologyStreak, session.turns);
      if (signals.apologyStreak >= 2) recordSignal("ozur_dongusu");
      updateRing();
      maybeShowExitCard();
    },
    onSendNotSeen: () => {
      // Sayfa mesajı göndermedi (örneğin yeni açılmış sekmede Enter işlenmedi): sayılmadı.
      console.log("[KafiAI] gönderme girişimi sayfada görülmedi, mesaj sayılmadı");
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

  /**
   * Sohbet değişti: bellekteki her şey silinir. Önceki sohbetin mesajları sayfada bir süre
   * daha durabildiği için (tek sayfalık uygulamalarda yeni sohbet geç çizilir) o anki liste
   * "eski" diye işaretlenir; geçmiş okuyucu sayfa değişene kadar onu yeni sohbetin geçmişi saymaz.
   */
  const resetConversation = () => {
    endConversation(); // önceki sohbetin sonucu, durum sıfırlanmadan önce
    // Bildiğimiz eski mesajlarla birebir aynı liste görünürse sayfa henüz değişmemiştir.
    // Sayfanın o anki hâli kullanılmaz: gecikmeyle fark edilen geçişte o zaten yeni sohbet olabilir.
    staleHistory = historySignature(userTexts);
    detector.reset();
    signals.reset();
    seenSignals.clear();
    strip.hide();
    exitCard.hide();
    ring.hide();
    ringPeak = 0;
    ringExplained = false;
    ringLogged = 0;
    policy.reset();
    userTexts = [];
    hiddenTurns = 0;
    lastPrediction = null;
    personal = false;
    similarCount = 0;
    emptyTicks = 0;
    history.cancel();
    if (active() && session.key !== null) history.begin(Date.now()); // başka bir var olan sohbet açıldı
    else if (active()) void checkFreshStart();
  };

  let lastHref = location.href;
  const navTimer = window.setInterval(() => {
    if (active()) updateRing(); // şerit ya da kart kapandıysa geri gelir, mesaj kutusu kaydıysa yeniden yerleşir
    if (location.href === lastHref) {
      if (active() && blankedInPlace()) {
        console.log("[KafiAI] sayfa adres değişmeden boşaldı (yeni sohbet sayıldı): durum sıfırlandı");
        session.restart();
        resetConversation();
      }
      return;
    }
    const previous = lastHref;
    lastHref = location.href;
    const nextKey = adapter.conversationKey(new URL(location.href));
    const result = session.onNavigate(nextKey);
    if (result === "reset") resetConversation();
    if (active()) {
      console.log(`[KafiAI] sohbet adresi değişti: ${result} (${mask(previous)} → ${mask(location.href)})`);
    }
  }, NAV_POLL_MS);

  // Araç çubuğu penceresinden gelen istekler. Cevapta mesaj metni yok; yalnızca sayılar.
  const snapshot = (): ConversationSnapshot => {
    const task = currentTask();
    const norm = task !== null ? taskNorm(task) : null;
    return {
      platform,
      active: active(),
      suggesting: suggesting(),
      intervening: intervening(),
      personal,
      turns: userTexts.length + hiddenTurns,
      task,
      similar: similarCount,
      recent_similar: signals.recentSimilar,
      apology_streak: signals.apologyStreak,
      vague_streak: signals.vagueStreak,
      segments: signals.segments,
      exited: signals.exited,
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
    ring.hide();
    window.clearInterval(historyTimer);
  });
  // Sekme arka plana geçince biriken sayaçlar yazılır (sekme sonra kapatılabilir).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void counters.flush();
  });

  console.log(`[KafiAI] ${adapter.name} adaptörü hazır`);
  return true;
}

/**
 * Google'da içerik betiği bütün arama sayfalarına yüklenir ama yalnızca AI Modu'nda çalışmalı.
 * Kullanıcı normal aramadan AI Modu'na sayfa yenilenmeden geçebildiği için, arama sayfasında
 * adres AI Modu'na dönene kadar yalnızca adrese bakılır; sayfadaki hiçbir şey okunmaz.
 */
function boot(): void {
  if (main()) return;
  if (!/(^|\.)google\.com$/.test(location.hostname) || location.pathname !== "/search") return;
  const timer = window.setInterval(() => {
    if (platformFor(new URL(location.href)) && main()) window.clearInterval(timer);
  }, NAV_POLL_MS);
  window.addEventListener("pagehide", () => window.clearInterval(timer));
}

boot();
