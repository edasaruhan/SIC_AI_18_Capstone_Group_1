"""Ortak test ayarları.

Testlerin çoğu yalnızca depodaki dosyalarla (örnek dosyalar, eklentinin JSON kuralları) çalışır.
Ham veri (data/processed) gerektiren testler `requires_data` işaretiyle yazılır; veri yoksa
(örneğin GitHub Actions'ta) neden atlandığını söyleyerek atlanır.
"""

from pathlib import Path

import pytest

PROCESSED = Path(__file__).resolve().parents[1] / "data" / "processed"


def pytest_configure(config):
    config.addinivalue_line("markers", "requires_data(*files): data/processed altında bu dosyalar yoksa testi atla")


def pytest_runtest_setup(item):
    marker = item.get_closest_marker("requires_data")
    if marker is None:
        return
    missing = [name for name in marker.args if not (PROCESSED / name).exists()]
    if missing:
        pytest.skip(f"ham veri yok ({', '.join(missing)}); önce indirme scriptlerini çalıştırın, bkz. README")
