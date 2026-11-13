/** Mesaj kutusunun içeriği (kırpılmamış): satır sonları dahil. */
function rawText(box: HTMLElement): string {
  return box.innerText || box.textContent || "";
}

/**
 * Metni kutunun sonuna, kutu doluysa yeni bir satır olarak ekler. Sayfanın kendi düzenleyicisi
 * değişikliği görsün diye tarayıcının yazma komutlarını kullanır; innerHTML'e dokunmaz.
 */
export function appendAsNewLine(composer: HTMLElement, text: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  composer.focus();
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(composer);
  range.collapse(false); // imleci sona koy
  selection.removeAllRanges();
  selection.addRange(range);
  if (rawText(composer).trim() !== "") {
    // Önce yeni paragraf; düzenleyici bunu görmezse satır sonu dene.
    const lineBreaks = () => (rawText(composer).match(/\n/g) ?? []).length;
    const before = lineBreaks();
    document.execCommand("insertParagraph");
    if (lineBreaks() === before) document.execCommand("insertLineBreak");
  }
  return document.execCommand("insertText", false, text);
}

/**
 * Metni kutunun sonuna aynı satırda, bir boşlukla ekler. ProseMirror kullanan sitelerde (ChatGPT,
 * Claude) "yeni paragraf" komutu Enter gibi yorumlanıp mesajı göndertebiliyor (elle doğrulamada
 * ChatGPT'de görüldü); bu yüzden orada satır sonu hiç denenmez.
 */
export function appendInline(composer: HTMLElement, text: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  composer.focus();
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(composer);
  range.collapse(false); // imleci sona koy
  selection.removeAllRanges();
  selection.addRange(range);
  const current = rawText(composer);
  const addition = current.trim() !== "" && !/\s$/.test(current) ? ` ${text}` : text;
  return document.execCommand("insertText", false, addition);
}

/**
 * Metni bir <textarea> kutusunun sonuna, kutu doluysa yeni satırda ekler. Sayfa değişikliği görsün
 * diye tarayıcının yazma komutunu kullanır (input olayı tetiklenir); olmazsa değeri doğrudan yazıp
 * input olayını kendisi gönderir.
 */
export function appendToTextarea(box: HTMLTextAreaElement, text: string): boolean {
  box.focus();
  const end = box.value.length;
  box.setSelectionRange(end, end);
  const addition = box.value.trim() !== "" ? `\n${text}` : text;
  if (typeof document.execCommand === "function" && document.execCommand("insertText", false, addition)) return true;
  box.value = box.value + addition;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
