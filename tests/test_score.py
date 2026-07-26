"""O motor de score: fatores contínuos, melhor janela e rótulos (em inglês)."""
import math

import pytest

from app import score as s


# ---- transmissão das nuvens ----

def test_cloud_transmission_clear_is_one():
    assert s._cloud_transmission(0, 0, 0, 0) == pytest.approx(1.0)


def test_cloud_transmission_low_overcast_is_zero():
    # estratos baixos a 100% não deixam passar nada
    assert s._cloud_transmission(100, 0, 0, 100) == pytest.approx(0.0)


def test_cloud_transmission_high_cirrus_passes_half():
    # cirros altos a 100% deixam passar metade (peso 0.5)
    assert s._cloud_transmission(0, 0, 100, 100) == pytest.approx(0.5)


def test_cloud_transmission_falls_back_to_total_when_layers_missing():
    assert s._cloud_transmission(None, None, None, 40) == pytest.approx(0.6)


# ---- transparência ----

def test_transparency_factor_dry_air_reaches_one():
    assert s._transparency_factor(9.0, floor=0.7) == pytest.approx(1.0)


def test_transparency_factor_wet_air_hits_floor():
    assert s._transparency_factor(0.0, floor=0.7) == pytest.approx(0.7)


def test_transparency_factor_unknown_is_midpoint():
    assert s._transparency_factor(None, floor=0.7) == pytest.approx(0.85)


# ---- seeing (jet stream) ----

def test_seeing_factor_calm_is_one():
    assert s._seeing_factor(10.0, floor=0.45) == pytest.approx(1.0)


def test_seeing_factor_rough_hits_floor():
    assert s._seeing_factor(130.0, floor=0.45) == pytest.approx(0.45)


def test_seeing_factor_unknown_is_midpoint():
    assert s._seeing_factor(None, floor=0.45) == pytest.approx((1.0 + 0.45) / 2)


# ---- Lua ----

def test_moon_factor_below_horizon_no_penalty():
    assert s._moon_factor(1.0, 0.0, 0.7) == 1.0
    assert s._moon_factor(1.0, -20.0, 0.7) == 1.0


def test_moon_factor_full_at_zenith():
    # 1 - peso·iluminação·sin(90) = 1 - 0.7
    assert s._moon_factor(1.0, 90.0, 0.7) == pytest.approx(0.3)


def test_moon_factor_new_moon_no_penalty():
    assert s._moon_factor(0.0, 90.0, 0.7) == pytest.approx(1.0)


# ---- poluição luminosa ----

@pytest.mark.parametrize("bortle,expected", [
    (None, 1.0), (1, 1.0), (9, s.LP_MIN_FACTOR), (5, 0.65),
    (0, 1.0),    # clamp para 1
    (99, s.LP_MIN_FACTOR),  # clamp para 9
])
def test_light_pollution_factor(bortle, expected):
    assert s.light_pollution_factor(bortle) == pytest.approx(expected)


# ---- duração e melhor janela ----

def test_duration_factor_saturates_at_full_credit():
    assert s._duration_factor(s.FULL_CREDIT_HOURS) == pytest.approx(1.0)
    assert s._duration_factor(2 * s.FULL_CREDIT_HOURS) == pytest.approx(1.0)
    assert s._duration_factor(1.0) == pytest.approx(0.5)


def test_best_window_empty_is_none():
    assert s._best_window([]) is None


def test_best_window_picks_the_good_stretch():
    # duas horas perfeitas no meio, cercadas de lixo
    best = s._best_window([0.0, 1.0, 1.0, 0.0])
    assert (best["i"], best["j"]) == (1, 2)


def test_best_window_prefers_longer_on_tie():
    # noite uniformemente perfeita: fica com o troço inteiro
    best = s._best_window([1.0] * 6)
    assert (best["i"], best["j"]) == (0, 5)


# ---- rótulos (todos em inglês) ----

@pytest.mark.parametrize("val,expected", [
    (80, "Excellent"), (60, "Good"), (40, "Fair"), (10, "Poor"),
])
def test_verdict_labels(val, expected):
    assert s._verdict(val) == expected


@pytest.mark.parametrize("illum,expected", [
    (0, "New Moon"), (20, "Crescent Moon"), (50, "Half Moon"),
    (80, "Gibbous Moon"), (100, "Full Moon"),
])
def test_moon_phase_names(illum, expected):
    assert s._moon_phase_name(illum) == expected


def test_transparency_and_seeing_and_dew_labels_english():
    assert s._transparency_label(7) == "good"
    assert s._transparency_label(None) == "unknown"
    assert s._transparency_label(1) == "poor"
    assert s._seeing_label(10) == "excellent"
    assert s._seeing_label(200) == "poor"
    assert s._dew_risk(1) == "high"
    assert s._dew_risk(10) == "low"


def test_feels_like_only_bites_when_cold_and_windy():
    # acima de 10°C não há wind chill
    assert s._feels_like(15.0, 30.0) == 15.0
    # frio + vento → sensação mais baixa que a temperatura
    assert s._feels_like(0.0, 30.0) < 0.0
