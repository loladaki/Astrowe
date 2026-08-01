"""Sugestão de sítios mais escuros: geometria + ranking (com LP mockado)."""
import asyncio

import pytest

from app import darksky


def test_haversine_one_degree_lon_at_equator():
    # 1° de longitude no equador ≈ 111 km.
    assert darksky.haversine_km(0, 0, 0, 1) == pytest.approx(111.19, abs=0.5)


def test_destination_and_back_is_consistent():
    lat, lon = darksky.destination(38.72, -9.14, 45, 50)   # 50 km para NE
    assert darksky.haversine_km(38.72, -9.14, lat, lon) == pytest.approx(50, abs=0.5)


def test_bearing_cardininals():
    assert darksky.bearing_deg(0, 0, 1, 0) == pytest.approx(0, abs=1)     # norte
    assert darksky.bearing_deg(0, 0, 0, 1) == pytest.approx(90, abs=1)    # este


def test_candidate_points_count_and_radius():
    pts = darksky.candidate_points(38.72, -9.14, 30)
    assert len(pts) == len(darksky.RING_FRACTIONS) * len(darksky.BEARINGS)
    for cy, cx in pts:
        assert darksky.haversine_km(38.72, -9.14, cy, cx) <= 30 + 0.5


def _fake_fetch(dark_when):
    """Devolve um fetch async que dá céu escuro onde `dark_when(lat, lon)`."""
    async def fetch(lat, lon, client=None):
        if dark_when(lat, lon):
            return {"sqm": 21.5, "bortle": 3, "description": "dark sky"}
        return {"sqm": 18.0, "bortle": 8, "description": "urban sky, heavily polluted"}
    return fetch


def test_darker_nearby_finds_the_dark_side(monkeypatch):
    # Origem clara (0,0); só o lado norte é escuro.
    monkeypatch.setattr(darksky.lightpollution, "fetch",
                        _fake_fetch(lambda lat, lon: lat > 0.1))
    out = asyncio.run(darksky.darker_nearby(0.0, 0.0, radius_km=30))
    assert out["origin"]["sqm"] == 18.0
    assert out["suggestions"], "deve haver sugestões do lado escuro"
    for s in out["suggestions"]:
        assert s["sqm"] >= 18.0 + darksky.MIN_SQM_GAIN
        assert s["lat"] > 0                     # vieram todas do lado norte (escuro)
        assert s["direction"] in {"N", "NE", "NNE", "NW", "NNW"}
        assert s["distance_km"] > 0


def test_darker_nearby_empty_when_nothing_darker(monkeypatch):
    # Tudo à mesma luminosidade da origem: nada ganha o suficiente.
    monkeypatch.setattr(darksky.lightpollution, "fetch",
                        _fake_fetch(lambda lat, lon: False))
    out = asyncio.run(darksky.darker_nearby(0.0, 0.0, radius_km=30))
    assert out["suggestions"] == []


def test_darker_nearby_without_data(monkeypatch):
    async def none_fetch(lat, lon, client=None):
        return None
    monkeypatch.setattr(darksky.lightpollution, "fetch", none_fetch)
    out = asyncio.run(darksky.darker_nearby(0.0, 0.0, radius_km=30))
    assert out["origin"] is None
    assert out["suggestions"] == []
