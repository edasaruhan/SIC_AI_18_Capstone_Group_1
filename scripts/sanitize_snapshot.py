"""Sayfa görüntülerini (kaydedilmiş HTML) teste girmeden önce kişisel veriden temizler.

Adaptör testleri (P5, P6) gerçek sayfa yapısına ihtiyaç duyuyor, ama kaydedilen sayfada hesap adı,
e-posta, profil resmi, kenar çubuğundaki sohbet başlıkları, sohbet kimlikleri ve oturum belirteçleri
bulunuyor. Bu betik bunları çıkarır ve neyin kaç kez çıkarıldığını raporlar. İçeriği raporlamaz;
rapor da temiz kalır.

Kullanım (depo kökünden):

    python scripts/sanitize_snapshot.py snapshots_raw --name "Ad Soyad" --name "kullanici_adi"

Ham dosyalar `snapshots_raw/` altında durur (git'e girmez). Dosya adları
`<platform>_<tr|en>_<durum>.html` biçiminde olmalı; örnek: `claude_tr_bos_sohbet.html`.
Temizlenmiş hâller `extension/test-snapshots/<platform>/<tr|en>_<durum>.html` yoluna yazılır.

Neler çıkarılır:
- `<script>` ve `<style>` içerikleri, HTML yorumları
- e-posta adresleri
- `--name` ile verilen hesap adları (büyük küçük harf duyarsız)
- resim, iframe ve arka plan resmi adresleri (profil resimleri dahil)
- sohbet bağlantılarının metni ve adresi (kenar çubuğundaki başlıklar), sayfa başlığı
- UUID'ler ve uzun belirteç benzeri dizgiler (en az 24 karakter, harf ve rakam karışık), JWT'ler
- `nonce`, `integrity` gibi güvenlik öznitelikleri

Mesajların kendisi temizlenmez: sayfa görüntüsünü alırken uydurma, kişisel olmayan mesajlar kullan.

Temizlikten sonra çıktı yeniden taranır; e-posta, ad, UUID ya da belirteç kalırsa dosya yazılmaz ve
betik hata koduyla çıkar. `--check DİZİN` yalnızca taramayı yapar (testler bunu kullanır).
"""

import argparse
import html
import json
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "extension" / "src" / "data" / "counter-schema.json").read_text(encoding="utf-8"))
PLATFORMS = SCHEMA["dimensions"]["platform"]
OUT_DIR = ROOT / "extension" / "test-snapshots"

NAME_RE = re.compile(r"^(?P<platform>[a-z_]+?)_(?P<lang>tr|en)_(?P<state>[a-z0-9_]+)\.html$")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
UUID_RE = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")
TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_\-])[A-Za-z0-9_\-]{24,}(?![A-Za-z0-9_\-])")
BG_URL_RE = re.compile(r"url\(\s*(['\"]?)(?!data:)[^)'\"]*\1\s*\)")

# Sohbet bağlantıları: kenar çubuğundaki başlıklar bu bağlantıların metninde durur.
CONVERSATION_HREF_RE = re.compile(
    r"^(?:https?://[^/]+)?/(?:c|g/[^/]+/c|app|chat|chats|conversations?|share|thread)/[^/?#]+"
)
URL_ATTRS = {"src", "srcset", "poster", "data-src", "data-srcset"}
DROP_ATTRS = {"nonce", "integrity"}
KEEP_TOKEN_ATTRS = {"class", "data-testid"}  # sabit adlar; adaptörler bunlara dayanıyor
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

UUID_PLACEHOLDER = "00000000-0000-4000-8000-000000000000"
TOKEN_PLACEHOLDER = "BELIRTEC"
EMAIL_PLACEHOLDER = "kisi@example.com"
NAME_PLACEHOLDER = "Kullanici"
TITLE_PLACEHOLDER = "Sohbet"


def is_token(s):
    """Rastgele görünen dizgi mi? `conversation-turn-12` gibi okunur adlar belirteç sayılmaz."""
    for part in re.split(r"[-_]", s):
        if len(part) >= 20 and any(c.isdigit() for c in part) and any(c.isalpha() for c in part):
            return True
    digits = sum(c.isdigit() for c in s)
    return digits >= 4 and digits / len(s) >= 0.2 and any(c.isalpha() for c in s)


class Sanitizer(HTMLParser):
    def __init__(self, names):
        super().__init__(convert_charrefs=False)
        self.names = [re.compile(re.escape(n), re.IGNORECASE) for n in names if n.strip()]
        self.out = []
        self.report = Counter()
        self.skip_depth = None  # script ya da style içindeyken
        self.conv_depth = 0  # sohbet bağlantısı içindeyken metin değişir
        self.conv_count = 0
        self.in_title = False

    # Metin temizliği: hem metin düğümlerine hem öznitelik değerlerine uygulanır.
    def clean_text(self, s, tokens=True):
        s, n = EMAIL_RE.subn(EMAIL_PLACEHOLDER, s)
        self.report["e-posta"] += n
        for rx in self.names:
            s, n = rx.subn(NAME_PLACEHOLDER, s)
            self.report["hesap adı"] += n
        s, n = JWT_RE.subn(TOKEN_PLACEHOLDER, s)
        self.report["belirteç"] += n
        s, n = UUID_RE.subn(UUID_PLACEHOLDER, s)
        self.report["UUID"] += n
        if tokens:
            def repl(m):
                if m.group(0) == TOKEN_PLACEHOLDER or not is_token(m.group(0)):
                    return m.group(0)
                self.report["belirteç"] += 1
                return TOKEN_PLACEHOLDER
            s = TOKEN_RE.sub(repl, s)
        return s

    def clean_attrs(self, tag, attrs):
        cleaned = []
        is_conv_link = tag == "a" and any(k == "href" and v and CONVERSATION_HREF_RE.match(v) for k, v in attrs)
        for key, value in attrs:
            if key in DROP_ATTRS:
                self.report["güvenlik özniteliği"] += 1
                continue
            if value is None:
                cleaned.append((key, None))
                continue
            if key in URL_ATTRS and tag in {"img", "source", "iframe", "video", "image"} and not value.startswith("data:"):
                self.report["resim ya da çerçeve adresi"] += 1
                value = "about:blank" if tag == "iframe" else "data:,"
            elif key == "style":
                value, n = BG_URL_RE.subn("url(data:,)", value)
                self.report["arka plan resmi"] += n
            elif is_conv_link and key == "href":
                self.conv_count += 1
                prefix = CONVERSATION_HREF_RE.match(value).group(0).rsplit("/", 1)[0]
                value = f"{prefix}/ornek-{self.conv_count}"
                self.report["sohbet bağlantısı"] += 1
            elif tag == "image" and key in {"href", "xlink:href"} and not value.startswith("data:"):
                self.report["resim ya da çerçeve adresi"] += 1
                value = "data:,"
            if key in {"title", "aria-label"} and (self.conv_depth or is_conv_link):
                value = TITLE_PLACEHOLDER
            value = self.clean_text(value, tokens=key not in KEEP_TOKEN_ATTRS)
            cleaned.append((key, value))
        return cleaned, is_conv_link

    @staticmethod
    def render(tag, attrs, close=False):
        parts = [tag]
        for k, v in attrs:
            parts.append(k if v is None else f'{k}="{html.escape(v, quote=True)}"')
        return "<" + " ".join(parts) + (" />" if close else ">")

    def handle_starttag(self, tag, attrs):
        if self.skip_depth is not None:
            return
        cleaned, is_conv = self.clean_attrs(tag, attrs)
        self.out.append(self.render(tag, cleaned))
        if tag in {"script", "style"}:
            self.skip_depth = tag
        elif tag == "title":
            self.in_title = True
        elif tag == "a" and (is_conv or self.conv_depth):
            self.conv_depth += 1
        elif self.conv_depth and tag not in VOID:
            self.conv_depth += 1

    def handle_startendtag(self, tag, attrs):
        if self.skip_depth is not None:
            return
        cleaned, _ = self.clean_attrs(tag, attrs)
        self.out.append(self.render(tag, cleaned, close=True))

    def handle_endtag(self, tag):
        if self.skip_depth is not None:
            if tag != self.skip_depth:
                return
            self.skip_depth = None
        if tag == "title":
            self.in_title = False
        if self.conv_depth and tag not in VOID:
            self.conv_depth -= 1
        self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self.skip_depth is not None:
            if data.strip():
                self.report[f"{self.skip_depth} içeriği"] += 1
            return
        if self.in_title and data.strip():
            self.report["sayfa başlığı"] += 1
            self.out.append(TITLE_PLACEHOLDER)
            return
        if self.conv_depth and data.strip():
            self.report["sohbet başlığı"] += 1
            self.out.append(TITLE_PLACEHOLDER)
            return
        self.out.append(self.clean_text(data))

    def handle_entityref(self, name):
        if self.skip_depth is None:
            self.out.append(f"&{name};")

    def handle_charref(self, name):
        if self.skip_depth is None:
            self.out.append(f"&#{name};")

    def handle_comment(self, data):
        self.report["HTML yorumu"] += 1

    def handle_decl(self, decl):
        self.out.append(f"<!{decl}>")

    def handle_pi(self, data):
        pass

    def unknown_decl(self, data):
        pass


def sanitize(text, names=()):
    """Temizlenmiş HTML ve rapor (kategori → sayı) döner."""
    parser = Sanitizer(names)
    parser.feed(text)
    parser.close()
    return "".join(parser.out), {k: v for k, v in parser.report.items() if v}


def leftovers(text, names=()):
    """Temiz bir çıktıda bulunmaması gerekenler. Boş liste: temiz."""
    problems = []
    for email in set(EMAIL_RE.findall(text)) - {EMAIL_PLACEHOLDER}:
        problems.append(f"e-posta: {email[:3]}…")
    for n in names:
        if n.strip() and n.lower() in text.lower():
            problems.append("hesap adı geçiyor")
    if set(UUID_RE.findall(text)) - {UUID_PLACEHOLDER}:
        problems.append("UUID geçiyor")
    if JWT_RE.search(text):
        problems.append("JWT geçiyor")
    if re.search(r"<script\b[^>]*>\s*[^<\s]", text, re.IGNORECASE):
        problems.append("script içeriği geçiyor")
    for m in re.finditer(r'<(?:img|source|iframe|video)\b[^>]*\s(?:src|srcset)="(https?:[^"]*)"', text, re.IGNORECASE):
        problems.append(f"dış resim adresi: {m.group(1)[:30]}…")
    tokens = {m for m in TOKEN_RE.findall(_strip_kept_attrs(text)) if is_token(m) and m != TOKEN_PLACEHOLDER}
    if tokens:
        problems.append(f"belirteç benzeri {len(tokens)} dizgi")
    return problems


def _strip_kept_attrs(text):
    return re.sub(r'\s(?:class|data-testid)="[^"]*"', "", text)


def target_path(src):
    m = NAME_RE.match(src.name)
    if not m or m.group("platform") not in PLATFORMS:
        return None
    return OUT_DIR / m.group("platform") / f"{m.group('lang')}_{m.group('state')}.html"


def check_dir(directory, names=()):
    failures = {}
    for path in sorted(Path(directory).rglob("*.html")):
        problems = leftovers(path.read_text(encoding="utf-8"), names)
        if problems:
            failures[str(path)] = problems
    return failures


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("inputs", nargs="*", type=Path, help="ham HTML dosyaları ya da klasörü (snapshots_raw)")
    ap.add_argument("--name", action="append", default=[], help="çıkarılacak hesap adı; birden çok kez verilebilir")
    ap.add_argument("--check", type=Path, help="yalnızca bu klasördeki temiz dosyaları tara")
    args = ap.parse_args(argv)

    if args.check:
        failures = check_dir(args.check, args.name)
        for path, problems in failures.items():
            print(f"KİRLİ {path}: {', '.join(problems)}")
        print("Temiz." if not failures else f"{len(failures)} dosyada sorun var.")
        return 1 if failures else 0

    files = []
    for p in args.inputs or [ROOT / "snapshots_raw"]:
        files += sorted(p.glob("*.html")) if p.is_dir() else [p]
    if not files:
        print("Dosya bulunamadı. Ham sayfaları snapshots_raw/ altına koy.")
        return 1
    if not args.name:
        print("Uyarı: --name verilmedi; hesap adı yalnızca e-posta biçimindeyse yakalanır.\n")

    failed = 0
    for src in files:
        dst = target_path(src)
        if dst is None:
            print(f"ATLANDI {src.name}: ad <platform>_<tr|en>_<durum>.html olmalı; platformlar: {', '.join(PLATFORMS)}")
            failed += 1
            continue
        clean, report = sanitize(src.read_text(encoding="utf-8", errors="replace"), args.name)
        problems = leftovers(clean, args.name)
        summary = ", ".join(f"{k} {v}" for k, v in sorted(report.items())) or "çıkarılan bir şey yok"
        if problems:
            print(f"YAZILMADI {src.name}: temizlikten sonra kalanlar: {', '.join(problems)}")
            failed += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(clean, encoding="utf-8")
        size = len(clean.encode("utf-8")) / 1024
        print(f"{src.name} → {dst.relative_to(ROOT)} ({size:.0f} KB)\n  çıkarılanlar: {summary}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
