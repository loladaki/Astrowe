"""Passagens da ISS: parsing do TLE e cálculo das passagens visíveis.

Usa um TLE fixo (offline, determinístico) — sem tocar na rede."""
from datetime import datetime

from app import satellites

# TLE real da ISS (época ~29/07/2026); fixo para o teste ser determinístico.
ISS_TLE = (
    "1 25544U 98067A   26210.12010945  .00008919  00000+0  16839-3 0  9999",
    "2 25544  51.6320  92.5793 0007055 349.1886  10.8949 15.49239716578255",
)


def test_parse_tle_from_three_line_block():
    text = "ISS (ZARYA)\n" + ISS_TLE[0] + "\n" + ISS_TLE[1] + "\n"
    assert satellites._parse_tle(text) == ISS_TLE


def test_parse_tle_garbage_is_none():
    assert satellites._parse_tle("not a tle at all") is None


def test_iss_passes_graceful_without_tle(monkeypatch):
    # Rede em baixo (sem TLE) → degrada para [], sem partir a previsão.
    monkeypatch.setattr(satellites, "fetch_iss_tle", lambda: None)
    assert satellites.iss_passes(38.72, -9.14, 3600,
                                 datetime(2026, 7, 26, 21, 0),
                                 datetime(2026, 7, 27, 6, 0)) == []


def test_iss_passes_empty_window():
    assert satellites.iss_passes(38.72, -9.14, 3600, None, None, tle=ISS_TLE) == []


def test_iss_passes_finds_a_visible_pass():
    # Noite de 26/07 em Lisboa (pôr→nascer do Sol): há uma passagem visível.
    passes = satellites.iss_passes(38.72, -9.14, 3600,
                                   datetime(2026, 7, 26, 20, 51),
                                   datetime(2026, 7, 27, 6, 35), tle=ISS_TLE)
    assert len(passes) >= 1
    p = passes[0]
    assert set(p) >= {"start", "peak", "end", "peak_altitude_deg", "peak_direction",
                      "rise_direction", "set_direction", "duration_min"}
    assert p["peak_altitude_deg"] >= satellites.MIN_PASS_ALTITUDE_DEG
    assert p["duration_min"] > 0
