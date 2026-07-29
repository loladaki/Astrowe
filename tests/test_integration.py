"""Integração ponta-a-ponta do build_forecast, com meteorologia sintética
(sem rede). Apanha regressões de estrutura, de sincronia de chaves e de língua."""
from datetime import datetime, timedelta

import pytest

from app import satellites, score

HOURLY_VARS = [
    "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
    "relative_humidity_2m", "dew_point_2m", "temperature_2m", "visibility",
    "wind_speed_10m", "wind_gusts_10m", "wind_speed_250hPa",
    "precipitation_probability",
]

# tipos de objecto válidos (em inglês) que o backend pode devolver
VALID_KINDS = {
    "galaxy", "open cluster", "star cloud", "asterism", "globular cluster",
    "planetary nebula", "nebula", "supernova remnant", "double star",
    "planet", "moon",
}
VALID_VERDICTS = {"Excellent", "Good", "Fair", "Poor", "No dark night", "No data"}


def _synthetic_weather(days=7):
    base = datetime(2026, 7, 20, 0, 0)
    times = [(base + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M")
             for h in range(days * 24)]
    n = len(times)
    const = {
        "cloud_cover": 0.0, "cloud_cover_low": 0.0, "cloud_cover_mid": 0.0,
        "cloud_cover_high": 0.0, "relative_humidity_2m": 50.0,
        "dew_point_2m": 5.0, "temperature_2m": 16.0, "visibility": 30000.0,
        "wind_speed_10m": 6.0, "wind_gusts_10m": 9.0, "wind_speed_250hPa": 20.0,
        "precipitation_probability": 0.0,
    }
    hourly = {"time": times}
    for v in HOURLY_VARS:
        hourly[v] = [const[v]] * n
    return {"utc_offset_seconds": 3600, "timezone": "Europe/Lisbon",
            "hourly": hourly}


@pytest.fixture(scope="module", autouse=True)
def _no_network_iss():
    # As passagens da ISS buscam o TLE ao Celestrak; nos testes ficamos offline.
    from unittest import mock
    with mock.patch.object(satellites, "fetch_iss_tle", return_value=None):
        yield


@pytest.fixture(scope="module")
def forecast(_no_network_iss):
    data = _synthetic_weather()
    return score.build_forecast(data, 38.72, -9.14, "deepsky", None)


def test_returns_a_week_of_nights(forecast):
    assert 7 <= len(forecast.nights) <= 8


def test_scores_within_bounds(forecast):
    for n in forecast.nights:
        assert 0 <= n.score <= 100


def test_mode_label_is_english(forecast):
    assert forecast.mode_label == "deep sky"


def test_summary_is_english(forecast):
    assert "noite" not in forecast.summary.lower()


def test_nights_have_english_verdicts_and_kinds(forecast):
    usable = [n for n in forecast.nights if n.objects]
    assert usable, "clear-sky synthetic weather should yield usable nights"
    for n in usable:
        assert n.verdict in VALID_VERDICTS
        assert isinstance(n.headline, str) and n.headline
        for obj in n.objects:
            assert obj.kind in VALID_KINDS


def test_planetary_mode_leads_with_bright_targets():
    data = _synthetic_weather()
    fc = score.build_forecast(data, 38.72, -9.14, "planetary", None)
    assert fc.mode_label == "planets & Moon"
    night = next((n for n in fc.nights if n.objects), None)
    assert night is not None
    # em modo planetas, o primeiro objecto é a Lua ou um planeta
    assert night.objects[0].kind in {"moon", "planet"}
