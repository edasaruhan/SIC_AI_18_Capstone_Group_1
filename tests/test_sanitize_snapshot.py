"""Sayfa görüntüsü temizleyicisi: kişisel veri çıkıyor, adaptörlerin dayandığı yapı kalıyor."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("sanitize_snapshot", ROOT / "scripts" / "sanitize_snapshot.py")
ss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ss)

RAW = """<!DOCTYPE html>
<html lang="tr"><head>
<title>Python ödevi yardımı - ChatGPT</title>
<meta name="csrf" content="a8F3kd92LmQp0zXv7TnR4sYw1BcE6hJu">
<script nonce="Zx81kLm2Qa9Tb4Vc7Nd0Pe3Rf6Sg5Uh">window.__USER__ = {"email": "ayse.yilmaz@gmail.com", "name": "Ayşe Yılmaz"}</script>
<style>.x{background:url(https://cdn.example.com/a.png)}</style>
<link rel="stylesheet" href="/assets/app.css" integrity="sha384-abcdefghijklmnopqrstuvwxyz0123456789">
</head><body>
<!-- kullanıcı: ayse.yilmaz@gmail.com -->
<nav>
  <a href="/c/6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b" title="Doktora başvurusu"><div class="truncate">Doktora başvurusu</div></a>
  <a href="https://gemini.google.com/app/9a8b7c6d5e4f3a2b">Kira sözleşmesi</a>
  <a href="/settings">Ayarlar</a>
</nav>
<button aria-label="Hesap: Ayşe Yılmaz"><img src="https://lh3.googleusercontent.com/a/ACg8ocJ1x2y3z4" alt="Ayşe Yılmaz"></button>
<div style="background-image: url('https://avatars.example.com/u/123')"></div>
<span>AYŞE YILMAZ</span> <span>ayse.yilmaz@gmail.com</span>
<main>
  <div data-testid="conversation-turn-12" data-message-author-role="user" class="min-h-8 text-message flex w-full flex-col items-end gap-2">
    <div class="whitespace-pre-wrap">Bu fonksiyonu kısalt &amp; açıkla</div>
  </div>
  <div data-message-id="3f2e1d0c-b9a8-4765-8432-10fedcba9876">Yanıt metni</div>
  <p>Belirteç: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U</p>
  <p>oturum=Q7w9E2r4T6y8U1i3O5p7A9s2D4f6G8h0</p>
  <button data-testid="regenerate-button">Yeniden oluştur</button>
  <iframe src="https://accounts.google.com/frame"></iframe>
</main>
</body></html>"""

NAMES = ["Ayşe Yılmaz"]


def clean():
    return ss.sanitize(RAW, NAMES)


def test_personal_data_removed():
    out, _ = clean()
    for leaked in ["ayse.yilmaz", "Ayşe Yılmaz", "AYŞE YILMAZ", "Doktora başvurusu", "Kira sözleşmesi",
                   "Python ödevi", "6f1c2a7e", "9a8b7c6d5e4f3a2b", "3f2e1d0c", "eyJhbGci", "Q7w9E2r4",
                   "a8F3kd92", "googleusercontent", "avatars.example.com", "accounts.google.com",
                   "window.__USER__", "cdn.example.com", "nonce=", "integrity="]:
        assert leaked not in out, leaked
    assert ss.leftovers(out, NAMES) == []


def test_structure_kept():
    out, _ = clean()
    for kept in ['data-testid="conversation-turn-12"', 'data-message-author-role="user"',
                 'data-testid="regenerate-button"', "min-h-8 text-message flex w-full flex-col items-end gap-2",
                 "Bu fonksiyonu kısalt &amp; açıkla", '<a href="/settings">Ayarlar</a>', "Yeniden oluştur",
                 '<a href="/c/ornek-1"', 'href="https://gemini.google.com/app/ornek-2"', "<!DOCTYPE html>"]:
        assert kept in out, kept


def test_report_counts_categories():
    _, report = clean()
    assert report["sohbet bağlantısı"] == 2
    assert report["sohbet başlığı"] == 2
    assert report["sayfa başlığı"] == 1
    assert report["hesap adı"] >= 3
    assert report["e-posta"] == 1  # yorumdaki ve script içindekiler bütünüyle düşüyor
    assert report["resim ya da çerçeve adresi"] == 2
    assert report["arka plan resmi"] == 1
    assert report["UUID"] == 1
    assert report["güvenlik özniteliği"] == 2
    assert report["HTML yorumu"] == 1
    # rapor yalnızca sayı içerir, içerik değil
    assert all(isinstance(v, int) for v in report.values())


def test_leftovers_detects_dirty_html():
    assert ss.leftovers(RAW, NAMES)
    assert "hesap adı geçiyor" in ss.leftovers("<p>Ayşe Yılmaz</p>", NAMES)
    assert ss.leftovers("<p>6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b</p>")
    assert ss.leftovers('<img src="https://x.com/a.png">')
    assert ss.leftovers("<script>var a=1</script>")
    assert ss.leftovers("<p>Zx81kLm2Qa9Tb4Vc7Nd0Pe3Rf6Sg5Uh</p>")
    assert ss.leftovers('<div data-testid="conversation-turn-12" class="w-[calc(100%-2rem)]">x</div>') == []


def test_target_path_requires_naming_scheme():
    assert ss.target_path(Path("claude_tr_bos_sohbet.html")) == ss.OUT_DIR / "claude" / "tr_bos_sohbet.html"
    assert ss.target_path(Path("google_ai_mode_en_takip.html")) == ss.OUT_DIR / "google_ai_mode" / "en_takip.html"
    assert ss.target_path(Path("perplexity_tr_bos.html")) is None
    assert ss.target_path(Path("claude_de_bos.html")) is None


def test_committed_snapshots_are_clean():
    """Depoya giren her sayfa görüntüsü temiz olmalı (klasör boşsa da geçer)."""
    assert ss.check_dir(ss.OUT_DIR) == {}
