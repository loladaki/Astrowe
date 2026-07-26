"""Chuveiros de meteoros e núcleo da Via Láctea."""
from datetime import date, datetime

from app import events


def test_days_from_peak_handles_year_wrap():
    # Quadrântidas: pico a 3 de janeiro. 31/dez está a 3 dias (do ano seguinte).
    assert events._days_from_peak(date(2026, 12, 31), 1, 3) == 3


def test_days_from_peak_on_peak_is_zero():
    assert events._days_from_peak(date(2026, 8, 12), 8, 12) == 0


def test_meteor_shower_identifies_perseids():
    # Noite do pico das Perseidas → o chuveiro activo é esse.
    got = events.meteor_shower(date(2026, 8, 12), 38.72, -9.14, 3600,
                               datetime(2026, 8, 12, 2, 0), None, None)
    assert got is not None
    assert got["name"] == "Perseids"


def test_no_meteor_shower_far_from_any_peak():
    # Meados de setembro não tem nenhum dos chuveiros da tabela.
    assert events.meteor_shower(date(2026, 9, 15), 38.72, -9.14, 3600,
                                datetime(2026, 9, 15, 2, 0), None, None) is None
