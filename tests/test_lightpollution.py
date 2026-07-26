"""Poluição luminosa: conversão SQM e mapeamento para Bortle."""
import pytest

from app import lightpollution as lp


def test_pristine_sky_gives_canonical_sqm():
    # 0 de brilho artificial → SQM 22.00 (o máximo canónico).
    assert lp.sqm_from_artificial(0.0) == pytest.approx(22.0, abs=0.02)


def test_more_artificial_light_lowers_sqm():
    assert lp.sqm_from_artificial(1.0) < lp.sqm_from_artificial(0.0)
    assert lp.sqm_from_artificial(100.0) < lp.sqm_from_artificial(10.0)


@pytest.mark.parametrize("sqm,bortle", [
    (22.0, 1),   # pristino, acima de todos os limiares
    (21.6, 2),
    (21.4, 3),
    (21.0, 4),
    (19.5, 5),
    (17.0, 9),   # centro urbano
])
def test_bortle_from_sqm(sqm, bortle):
    assert lp.bortle_from_sqm(sqm) == bortle


def test_bortle_monotonic_in_sqm():
    # SQM maior (céu melhor) → Bortle menor ou igual.
    vals = [lp.bortle_from_sqm(s) for s in (17.0, 18.5, 20.0, 21.5, 22.0)]
    assert vals == sorted(vals, reverse=True)


def test_bortle_phrase_is_english_and_nonempty():
    assert lp.bortle_phrase(1) == "very dark sky"
    assert lp.bortle_phrase(9) == "urban sky, heavily polluted"
    for b in range(1, 10):
        phrase = lp.bortle_phrase(b)
        assert isinstance(phrase, str) and phrase
        # sem sobras de português
        assert "céu" not in phrase.lower()
