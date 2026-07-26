"""Janelas de noite e conversões de tempo (usa Skyfield → efemérides locais)."""
from datetime import date, datetime

import pytest

from app import astro


def test_local_utc_roundtrip():
    dt = datetime(2026, 7, 20, 23, 30)
    offset = 3600
    back = astro._utc_to_local(astro._local_to_utc(dt, offset), offset)
    assert back == dt


def test_compute_windows_structure_midlatitude_summer():
    lat, lon, offset = 38.72, -9.14, 3600   # Lisboa, verão (+1h)
    d = date(2026, 7, 20)
    dark = astro.compute_windows(lat, lon, offset, [d],
                                 astro.ASTRONOMICAL_TWILIGHT_DEG)[d]
    lit = astro.compute_windows(lat, lon, offset, [d], astro.SUNSET_DEG)[d]

    for start, end in (dark, lit):
        assert start is not None and end is not None
        assert start < end

    # a escuridão astronómica cai dentro da janela pôr→nascer do Sol
    assert lit[0] <= dark[0] and dark[1] <= lit[1]


def test_moon_is_waxing_returns_bool():
    assert isinstance(astro.moon_is_waxing(3600, datetime(2026, 7, 20, 23, 0)), bool)
