// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Session } from "../core/session";
import { chatgptAdapter, chatKeyFromPath, findComposer, isGenerating, readComposerText } from "./chatgpt";

/** Canlı sayfada ölçtüğümüz yapıyı taklit eden sahte sayfa. */
function renderPage(
  opts: { text?: string; stop?: boolean; stopLabel?: string; turnStates?: string[]; decoy?: boolean } = {},
) {
  const { text = "", stop = false, stopLabel = "Durdur", turnStates = [], decoy = false } = opts;
  // Canlı sayfada gerçek kutudan önce boş bir kopya var (Ekim 2026'da ölçüldü).
  const decoyForm = decoy
    ? `<form id="decoy">
         <button type="button" aria-label="Dosyaları ve daha fazlasını ekle"></button>
         <div contenteditable="true" role="textbox" aria-label="ChatGPT'ye sor"><p></p></div>
         <button type="button" aria-label="Sesli iletişimi başlat"></button>
       </form>`
    : "";
  const turns = turnStates
    .map((s) => `<div data-turn-key="x"><div data-talvt-turn-state="${s}"></div></div>`)
    .join("");
  document.body.innerHTML = `
    <main>${turns}</main>
    ${decoyForm}
    <form id="real">
      <button type="button" aria-label="Dosyaları ve daha fazlasını ekle"></button>
      <div role="presentation">
        <div contenteditable="true" role="textbox" aria-label="ChatGPT'ye sor"><p>${text}</p></div>
      </div>
      <button type="button" aria-label="Dikte et"></button>
      ${stop ? `<button type="button" aria-label="${stopLabel}"></button>` : ""}
      ${text && !stop ? `<button type="submit" aria-label="Gönder"></button>` : ""}
    </form>`;
}

/** Sayfanın mesajı gerçekten göndermesini taklit eder: kutu boşalır, doğrulama bir tik sonra görür. */
function pageSent() {
  document.querySelector<HTMLElement>("form#real [contenteditable]")!.innerHTML = "<p></p>";
  vi.advanceTimersByTime(150);
}

function pressEnter(opts: KeyboardEventInit = {}) {
  const box = document.querySelector<HTMLElement>("form#real [contenteditable]")!;
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...opts }));
}

describe("sayfa yapısı", () => {
  it("mesaj kutusunu bulur", () => {
    renderPage();
    expect(findComposer()).not.toBeNull();
  });

  it("form dışındaki contenteditable alanı mesaj kutusu saymaz", () => {
    document.body.innerHTML = `<div contenteditable="true" role="textbox"></div>`;
    expect(findComposer()).toBeNull();
  });

  it("kutudaki metni okur", () => {
    renderPage({ text: "merhaba" });
    expect(readComposerText(findComposer()!)).toBe("merhaba");
  });

  it("boş kutuda boş metin döner", () => {
    renderPage();
    expect(readComposerText(findComposer()!)).toBe("");
  });
});

describe("isGenerating", () => {
  it("boştayken false", () => {
    renderPage({ turnStates: ["complete"] });
    expect(isGenerating()).toBe(false);
  });

  it("tur durumu in_progress ise true", () => {
    renderPage({ turnStates: ["complete", "in_progress"] });
    expect(isGenerating()).toBe(true);
  });

  it("Durdur düğmesi varken true (tur hâlâ complete olsa bile)", () => {
    renderPage({ stop: true, turnStates: ["complete", "complete"] });
    expect(isGenerating()).toBe(true);
  });

  it("İngilizce 'Stop' etiketini de tanır", () => {
    renderPage({ stop: true, stopLabel: "Stop streaming" });
    expect(isGenerating()).toBe(true);
  });

  it("yalnızca Gönder düğmesi varsa false", () => {
    renderPage({ text: "merhaba" });
    expect(isGenerating()).toBe(false);
  });
});

describe("sayfada iki mesaj kutusu varken (canlı sayfadaki durum)", () => {
  let stop: () => void;
  const handlers = { onSend: vi.fn(), onResponseComplete: vi.fn(), onNoSignal: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(handlers).forEach((h) => h.mockReset());
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it("Enter'a basılan (ikinci) kutunun metnini okur, ilk boş kutuyu değil", () => {
    renderPage({ text: "merhaba", decoy: true });
    stop = chatgptAdapter.start(handlers);
    pressEnter();
    pageSent();
    expect(handlers.onSend).toHaveBeenCalledWith({ text: "merhaba" });
  });

  it("ikinci formdaki Gönder düğmesine tıklamayı yakalar", () => {
    renderPage({ text: "merhaba", decoy: true });
    stop = chatgptAdapter.start(handlers);
    document.querySelector<HTMLButtonElement>('form#real button[type="submit"]')!.click();
    pageSent();
    expect(handlers.onSend).toHaveBeenCalledWith({ text: "merhaba" });
  });

  it("Durdur düğmesi ikinci formdaysa da üretimi fark eder", () => {
    renderPage({ stop: true, decoy: true });
    expect(isGenerating()).toBe(true);
  });

  it("boş (gizli) kutuda Enter mesaj sayılmaz", () => {
    renderPage({ text: "merhaba", decoy: true });
    stop = chatgptAdapter.start(handlers);
    document
      .querySelector<HTMLElement>("form#decoy [contenteditable]")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(handlers.onSend).not.toHaveBeenCalled();
  });
});

describe("conversationKey ve matches", () => {
  it("sohbet kimliğini adresten çıkarır", () => {
    const url = new URL("https://chatgpt.com/c/68f8b5f6-4448-8191-9e9f-aaaaaaaaaaaa");
    expect(chatgptAdapter.conversationKey(url)).toBe("68f8b5f6-4448-8191-9e9f-aaaaaaaaaaaa");
  });

  it("yeni sohbette null döner", () => {
    expect(chatgptAdapter.conversationKey(new URL("https://chatgpt.com/"))).toBeNull();
  });

  it("proje içindeki sohbet adresini de tanır", () => {
    const url = new URL("https://chatgpt.com/g/g-p-123abc/c/68f8b5f6-4448-8191-9e9f-aaaaaaaaaaaa");
    expect(chatgptAdapter.conversationKey(url)).toBe("68f8b5f6-4448-8191-9e9f-aaaaaaaaaaaa");
  });

  it("geçici (local…) adresi yeni sohbet sayar", () => {
    expect(chatKeyFromPath("/c/local-6ad8f1c2-1111-2222-3333-444455556666%3A7a1b2c3d4e5f")).toBeNull();
    expect(chatKeyFromPath("/c/local%3A7a1b2c3d4e5f6a7b")).toBeNull();
  });

  it("geçersiz kodlamada çökmez", () => {
    expect(chatKeyFromPath("/c/%E0%A4%A")).toBeNull();
  });

  it("yeni sohbet: / → geçici adres → gerçek kimlik oturumu sıfırlamaz", () => {
    const session = new Session(chatKeyFromPath("/"));
    session.recordSend();
    expect(session.onNavigate(chatKeyFromPath("/c/local-6ad8f1c2-1111-2222-3333-444455556666%3A7a1b"))).toBe("keep");
    expect(session.onNavigate(chatKeyFromPath("/c/6ad8f1c2-1111-2222-3333-444455556666"))).toBe("adopt");
    expect(session.turns).toBe(1);
  });

  it("yalnızca ChatGPT sitelerinde eşleşir", () => {
    expect(chatgptAdapter.matches(new URL("https://chatgpt.com/"))).toBe(true);
    expect(chatgptAdapter.matches(new URL("https://chat.openai.com/"))).toBe(true);
    expect(chatgptAdapter.matches(new URL("https://example.com/"))).toBe(false);
  });
});

describe("start(): gönderme ve cevap bitişi", () => {
  let stop: () => void;
  const handlers = {
    onSend: vi.fn(),
    onResponseComplete: vi.fn(),
    onNoSignal: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(handlers).forEach((h) => h.mockReset());
  });

  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it("Enter ile gönderilen mesajı yakalar", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    pressEnter();
    pageSent();
    expect(handlers.onSend).toHaveBeenCalledWith({ text: "merhaba" });
  });

  it("Shift+Enter (yeni satır) mesaj sayılmaz", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    pressEnter({ shiftKey: true });
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it("IME ile yazarken (isComposing) Enter mesaj sayılmaz", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    pressEnter({ isComposing: true });
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it("boş kutuda Enter mesaj sayılmaz", () => {
    renderPage();
    stop = chatgptAdapter.start(handlers);
    pressEnter();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it("cevap üretilirken Enter mesaj sayılmaz", () => {
    renderPage({ text: "yeni mesaj", stop: true });
    stop = chatgptAdapter.start(handlers);
    pressEnter();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it("Gönder düğmesine tıklamayı yakalar", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    pageSent();
    expect(handlers.onSend).toHaveBeenCalledWith({ text: "merhaba" });
  });

  it("sayfa mesajı göndermezse (kutu dolu kalır) mesaj sayılmaz, onSendNotSeen çağrılır", () => {
    const notSeen = vi.fn();
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start({ ...handlers, onSendNotSeen: notSeen });
    pressEnter(); // ChatGPT bu Enter'ı işlemedi: kutu dolu kaldı
    vi.advanceTimersByTime(4100);
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(notSeen).toHaveBeenCalledTimes(1);
  });

  it("gitmeyen girişimden sonra yeniden Enter tek mesaj sayılır", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    pressEnter(); // işlenmedi
    vi.advanceTimersByTime(500);
    pressEnter(); // ikinci deneme gitti
    pageSent();
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
    expect(handlers.onSend).toHaveBeenCalledWith({ text: "merhaba" });
  });

  it("kutu boşalmasa da üretim başlarsa gönderilmiş sayılır", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    pressEnter();
    document.querySelector("main")!.insertAdjacentHTML("beforeend", `<div data-talvt-turn-state="in_progress"></div>`);
    vi.advanceTimersByTime(150);
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
  });

  it("form dışındaki bir tıklamayı yok sayar", () => {
    renderPage({ text: "merhaba" });
    document.body.insertAdjacentHTML("beforeend", `<button type="submit" id="other"></button>`);
    stop = chatgptAdapter.start(handlers);
    document.getElementById("other")!.click();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it("gönderme → Durdur görünür → Durdur kaybolur → onResponseComplete", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    pressEnter();

    renderPage({ stop: true, turnStates: ["complete", "complete"] });
    vi.advanceTimersByTime(1000);
    expect(handlers.onResponseComplete).not.toHaveBeenCalled();

    renderPage({ stop: true, turnStates: ["complete", "in_progress"] });
    vi.advanceTimersByTime(2000);
    expect(handlers.onResponseComplete).not.toHaveBeenCalled();

    renderPage({ turnStates: ["complete", "complete"] });
    vi.advanceTimersByTime(300);
    expect(handlers.onResponseComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(handlers.onResponseComplete).toHaveBeenCalledTimes(1);
  });

  it("hiç sinyal gelmezse onNoSignal çağrılır", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    pressEnter();
    renderPage({ turnStates: ["complete", "complete"] });
    vi.advanceTimersByTime(16000);
    expect(handlers.onNoSignal).toHaveBeenCalledTimes(1);
    expect(handlers.onResponseComplete).not.toHaveBeenCalled();
  });

  it("stop() sonrası dinleme biter", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    stop();
    pressEnter();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });
});

describe("gönderimi bekletme (onBeforeSend)", () => {
  let stop: () => void;
  const handlers = {
    onBeforeSend: vi.fn(),
    onSend: vi.fn(),
    onResponseComplete: vi.fn(),
    onNoSignal: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(handlers).forEach((h) => h.mockReset());
    handlers.onBeforeSend.mockReturnValue(false);
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it("false dönerse mesaj normal gider", () => {
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    pressEnter();
    expect(handlers.onBeforeSend).toHaveBeenCalledTimes(1);
    pageSent();
    expect(handlers.onSend).toHaveBeenCalledWith({ text: "merhaba" });
  });

  it("true dönerse Enter durdurulur, mesaj gönderilmiş sayılmaz", () => {
    handlers.onBeforeSend.mockReturnValue(true);
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    const box = document.querySelector<HTMLElement>("form#real [contenteditable]")!;
    const pageListener = vi.fn();
    box.addEventListener("keydown", pageListener); // sayfanın kendi dinleyicisi
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    box.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(pageListener).not.toHaveBeenCalled();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it("true dönerse Gönder düğmesine tıklama da durdurulur", () => {
    handlers.onBeforeSend.mockReturnValue(true);
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    const pageClick = vi.fn((e: Event) => e.preventDefault());
    const button = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.addEventListener("click", pageClick);
    button.click();
    expect(pageClick).not.toHaveBeenCalled();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it("anchor olarak mesaj kutusunun formunu verir", () => {
    renderPage({ text: "merhaba", decoy: true });
    stop = chatgptAdapter.start(handlers);
    pressEnter();
    expect(handlers.onBeforeSend.mock.calls[0]![0].anchor.id).toBe("real");
  });

  it("submitHeld() bekletilen mesajı bir kez gönderir, sayfa tıklamayı görür", () => {
    handlers.onBeforeSend.mockReturnValue(true);
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    const pageClick = vi.fn((e: Event) => e.preventDefault());
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.addEventListener("click", pageClick);
    pressEnter();
    expect(handlers.onSend).not.toHaveBeenCalled();

    expect(chatgptAdapter.submitHeld()).toBe(true);
    expect(handlers.onBeforeSend).toHaveBeenCalledTimes(1); // geçiş izni: tekrar sorulmadı
    expect(pageClick).toHaveBeenCalledTimes(1);
    pageSent();
    expect(handlers.onSend).toHaveBeenCalledWith({ text: "merhaba" });
    expect(chatgptAdapter.submitHeld()).toBe(false); // artık bekleyen yok
  });

  it("izin tek seferliktir: sonraki girişim yine sorulur", () => {
    handlers.onBeforeSend.mockReturnValue(true);
    renderPage({ text: "merhaba" });
    stop = chatgptAdapter.start(handlers);
    pressEnter();
    chatgptAdapter.submitHeld();
    renderPage({ text: "tekrar" });
    pressEnter();
    expect(handlers.onBeforeSend).toHaveBeenCalledTimes(2);
  });

  it("bekleyen yokken submitHeld() false döner", () => {
    expect(chatgptAdapter.submitHeld()).toBe(false);
  });
});

describe("insertText (onarım cümlesi ekleme)", () => {
  const exec = vi.fn();
  beforeEach(() => {
    exec.mockReset().mockReturnValue(true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
  });
  afterEach(() => {
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it("dolu kutuda aynı satıra boşlukla ekler; yeni paragraf denemez (Enter sayılıp mesajı göndermesin)", () => {
    renderPage({ text: "olmadı" });
    expect(chatgptAdapter.insertText("Aldığım hata mesajı: ")).toBe(true);
    expect(exec.mock.calls.map((c) => c[0])).toEqual(["insertText"]);
    expect(exec).toHaveBeenLastCalledWith("insertText", false, " Aldığım hata mesajı: ");
  });

  it("boş kutuda boşluk eklemeden yazar", () => {
    renderPage();
    chatgptAdapter.insertText("Daha kısa yaz.");
    expect(exec).toHaveBeenLastCalledWith("insertText", false, "Daha kısa yaz.");
  });

  it("komut başarısız olursa false döner", () => {
    exec.mockReturnValue(false);
    renderPage({ text: "merhaba" });
    expect(chatgptAdapter.insertText("x")).toBe(false);
  });

  it("mesaj kutusu yoksa false döner", () => {
    document.body.innerHTML = "";
    expect(chatgptAdapter.insertText("x")).toBe(false);
  });

  it("execCommand yoksa çökmez, false döner", () => {
    delete (document as unknown as { execCommand?: unknown }).execCommand;
    renderPage({ text: "merhaba" });
    expect(chatgptAdapter.insertText("x")).toBe(false);
  });
});

describe("readHistory (açılan sohbetteki eski mesajlar)", () => {
  // jsdom yerleşim hesaplamaz; görünürlüğü işaretle taklit ediyoruz: data-gizli olan 0 kutu döner.
  const original = HTMLElement.prototype.getClientRects;
  beforeEach(() => {
    HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
      return (this.hasAttribute("data-gizli") ? [] : [{}]) as unknown as DOMRectList;
    };
  });
  afterEach(() => {
    HTMLElement.prototype.getClientRects = original;
  });

  it("kullanıcı mesajlarını sırayla okur, asistanı almaz", () => {
    document.body.innerHTML = `
      <div data-content-search-unit-key="fallback-turn-0:0:user"><p>ilk istek</p></div>
      <div data-content-search-unit-key="fallback-turn-0:2:assistant"><p>cevap</p></div>
      <div data-content-search-unit-key="fallback-turn-1:0:user"><p> ikinci istek </p></div>
      <div data-content-search-unit-key="fallback-turn-1:2:assistant"><p>cevap 2</p></div>`;
    expect(chatgptAdapter.readHistory()).toEqual(["ilk istek", "ikinci istek"]);
  });

  it("önceki sohbetten kalan görünmez (yüksekliği 0) mesajı atlar", () => {
    document.body.innerHTML = `
      <div data-gizli data-content-search-unit-key="fallback-turn-0:0:user">önceki sohbetin mesajı</div>
      <div data-content-search-unit-key="fallback-turn-0:0:user">bu sohbetin mesajı</div>`;
    expect(chatgptAdapter.readHistory()).toEqual(["bu sohbetin mesajı"]);
  });

  it("boş (örneğin yalnızca dosya) mesajları atlar", () => {
    document.body.innerHTML = `
      <div data-content-search-unit-key="fallback-turn-0:0:user">   </div>
      <div data-content-search-unit-key="fallback-turn-1:0:user">merhaba</div>`;
    expect(chatgptAdapter.readHistory()).toEqual(["merhaba"]);
  });

  it("sayfada mesaj yoksa boş liste döner", () => {
    document.body.innerHTML = "<main></main>";
    expect(chatgptAdapter.readHistory()).toEqual([]);
  });
});

describe("mesaj düzenleme kutusu (tur içindeki kutu) yok sayılır", () => {
  let stop: () => void;
  const handlers = {
    onBeforeSend: vi.fn(),
    onSend: vi.fn(),
    onResponseComplete: vi.fn(),
    onNoSignal: vi.fn(),
  };

  /** Canlı sayfada ölçülen yapı: düzenleme formu [data-turn-key] içinde, asıl form dışında. */
  function renderWithEditBox() {
    document.body.innerHTML = `
      <main>
        <div data-turn-key="t1">
          <form id="edit">
            <div contenteditable="true" role="textbox"><p>düzenlenen mesaj</p></div>
            <button type="button">İptal et</button>
            <button type="submit">Gönder</button>
          </form>
        </div>
      </main>
      <form id="real">
        <div contenteditable="true" role="textbox"><p>asıl kutu</p></div>
        <button type="submit" aria-label="Gönder"></button>
      </form>`;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(handlers).forEach((h) => h.mockReset());
    handlers.onBeforeSend.mockReturnValue(true);
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it("düzenleme kutusunda Enter sormaz, bekletmez, sayılmaz", () => {
    renderWithEditBox();
    stop = chatgptAdapter.start(handlers);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    document.querySelector("form#edit [contenteditable]")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(handlers.onBeforeSend).not.toHaveBeenCalled();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it("düzenleme formundaki Gönder düğmesi sayılmaz", () => {
    renderWithEditBox();
    stop = chatgptAdapter.start(handlers);
    document.querySelector<HTMLButtonElement>('form#edit button[type="submit"]')!.click();
    expect(handlers.onBeforeSend).not.toHaveBeenCalled();
    expect(handlers.onSend).not.toHaveBeenCalled();
  });

  it("asıl mesaj kutusu etkilenmez", () => {
    renderWithEditBox();
    stop = chatgptAdapter.start(handlers);
    document
      .querySelector("form#real [contenteditable]")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(handlers.onBeforeSend).toHaveBeenCalledTimes(1);
  });

  it("findComposer düzenleme kutusunu değil asıl kutuyu verir", () => {
    renderWithEditBox();
    expect(findComposer()!.closest("form")!.id).toBe("real");
  });
});

describe("newChatUrl", () => {
  it("yeni sohbetin adresini verir", () => {
    expect(chatgptAdapter.newChatUrl()).toBe(`${location.origin}/`);
  });
});

describe("lastResponse", () => {
  it("son asistan cevabının metnini okur", () => {
    document.body.innerHTML = `
      <div data-content-search-unit-key="t0:1:user"><p>soru</p></div>
      <div data-content-search-unit-key="t0:2:assistant"><p>ilk cevap</p></div>
      <div data-content-search-unit-key="t1:2:assistant"><p>I apologize for the confusion.</p></div>`;
    expect(chatgptAdapter.lastResponse!()).toBe("I apologize for the confusion.");
    document.body.innerHTML = "";
    expect(chatgptAdapter.lastResponse!()).toBeNull();
  });
});
