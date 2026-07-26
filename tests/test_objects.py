"""Astronomia sem rede: airmass, culminação, série de alturas, bússola."""
import numpy as np
import pytest

from app import objects as o


# ---- airmass (Kasten-Young) ----

def test_airmass_zenith_is_one():
    assert o.airmass(90.0) == pytest.approx(1.0, abs=0.01)


def test_airmass_thirty_degrees_is_about_two():
    assert o.airmass(30.0) == pytest.approx(2.0, abs=0.05)


def test_airmass_ten_degrees_is_about_five_point_six():
    assert o.airmass(10.0) == pytest.approx(5.6, abs=0.2)


def test_airmass_below_horizon_is_none():
    assert o.airmass(0.0) is None
    assert o.airmass(-5.0) is None


# ---- altura de culminação ----

@pytest.mark.parametrize("lat,dec,expected", [
    (40.0, 0.0, 50.0),      # 90 - |40-0|
    (40.0, 40.0, 90.0),     # objeto passa no zénite
    (0.0, 90.0, 0.0),       # polo no horizonte do equador
    (38.7, 89.26, 39.44),   # 90 - |38.7 - 89.26| (Polaris culmina ~latitude)
])
def test_transit_altitude(lat, dec, expected):
    assert o.transit_altitude(lat, dec) == pytest.approx(expected, abs=0.01)


# ---- bússola (16 pontos, em inglês) ----

@pytest.mark.parametrize("az,point", [
    (0, "N"), (90, "E"), (180, "S"), (270, "W"),
    (45, "NE"), (135, "SE"), (225, "SW"), (315, "NW"),
    (202.5, "SSW"), (247.5, "WSW"), (292.5, "WNW"), (337.5, "NNW"),
    (360, "N"),
])
def test_compass_point(az, point):
    assert o.compass_point(az) == point


# ---- série de alturas: no meridiano bate com a culminação ----

def test_altitude_series_at_meridian_equals_transit_altitude():
    lat, ra, dec = 40.0, 6.0, 10.0
    # lst_start = ra e dt = 0  →  ângulo horário 0  →  objeto no meridiano
    alts = o.altitude_series(lat, [ra], [dec], lst_start_h=ra, hours_ahead=[0.0])
    assert alts[0][0] == pytest.approx(o.transit_altitude(lat, dec), abs=0.01)


def test_altitude_series_shape():
    alts = o.altitude_series(40.0, [6.0, 18.0], [10.0, -20.0],
                             lst_start_h=6.0, hours_ahead=[0.0, 1.0, 2.0])
    assert alts.shape == (3, 2)   # (horas, objetos)


# ---- tendência ----

def test_trend_labels_english():
    assert o._trend(1.0) == "rising"
    assert o._trend(-1.0) == "descending"
    assert o._trend(0.0) == "at its peak"


# ---- horas até à culminação ----

def test_hours_to_transit_zero_on_meridian():
    assert o.hours_to_transit(6.0, 6.0) == pytest.approx(0.0, abs=1e-6)
