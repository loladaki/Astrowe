"""Efemérides locais com Skyfield: janelas de noite e posição da Lua.

Tudo calculado offline (determinístico). Na primeira execução o Skyfield
descarrega `de421.bsp` (~17 MB) para a pasta de trabalho e fica em cache.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import numpy as np
from skyfield import almanac
from skyfield.api import load, wgs84

# Sol a −18° = crepúsculo/amanhecer astronómico (céu verdadeiramente escuro).
# Necessário para céu profundo; para planetas basta o Sol abaixo do horizonte.
ASTRONOMICAL_TWILIGHT_DEG = -18.0
SUNSET_DEG = -0.833  # inclui a refração atmosférica padrão

_ts = None
_eph = None


def _ensure_loaded():
    """Carrega (uma vez) a timescale e as efemérides."""
    global _ts, _eph
    if _eph is None:
        _ts = load.timescale()
        _eph = load("de421.bsp")
    return _ts, _eph


def _local_to_utc(dt_local: datetime, offset_seconds: int) -> datetime:
    """Hora local naive → UTC aware.

    Usamos o offset fixo do Open-Meteo (`utc_offset_seconds`). Ignora uma
    eventual mudança de DST dentro da janela de 7 dias — aceitável no MVP, e
    mantém-nos alinhados com os tempos locais que a API devolve.
    """
    return (dt_local - timedelta(seconds=offset_seconds)).replace(tzinfo=timezone.utc)


def _utc_to_local(dt_utc: datetime, offset_seconds: int) -> datetime:
    return (dt_utc + timedelta(seconds=offset_seconds)).replace(tzinfo=None)


def compute_windows(lat: float, lon: float, offset_seconds: int,
                    dates: list[date],
                    horizon_degrees: float) -> dict[date, tuple]:
    """Para cada dia, a janela nocturna: Sol a descer e a subir por `horizon_degrees`.

    Com −18° dá a janela de escuridão astronómica; com −0.833° dá do pôr ao
    nascer do Sol. Devolve horas locais naive, ou (None, None) se não houver
    (ex.: verão em latitudes altas, onde o Sol nunca desce a −18°).
    """
    ts, eph = _ensure_loaded()
    obs = eph["earth"] + wgs84.latlon(lat, lon)
    sun = eph["sun"]

    out: dict[date, tuple] = {}
    for d in dates:
        # Do meio-dia local deste dia ao meio-dia seguinte: a noite cabe aqui.
        local_noon = datetime(d.year, d.month, d.day, 12, 0, 0)
        t0 = ts.from_datetime(_local_to_utc(local_noon, offset_seconds))
        t1 = ts.from_datetime(
            _local_to_utc(local_noon + timedelta(days=1), offset_seconds))

        set_t, _ = almanac.find_settings(obs, sun, t0, t1,
                                         horizon_degrees=horizon_degrees)
        rise_t, _ = almanac.find_risings(obs, sun, t0, t1,
                                         horizon_degrees=horizon_degrees)

        start = set_t[0].utc_datetime() if len(set_t) else None
        end = None
        if start is not None:
            for rt in rise_t:
                if rt.utc_datetime() > start:
                    end = rt.utc_datetime()
                    break

        if start is None or end is None:
            out[d] = (None, None)
        else:
            out[d] = (_utc_to_local(start, offset_seconds),
                      _utc_to_local(end, offset_seconds))
    return out


def moon_series(lat: float, lon: float, offset_seconds: int,
                local_times: list[datetime]):
    """Altitude da Lua (graus) e fração iluminada (0–1) em cada instante dado.

    Calculado de uma vez para toda a série horária — a altitude é o que permite
    distinguir uma Lua rasante (quase inofensiva) de uma Lua no zénite.
    """
    if not local_times:
        return np.array([]), np.array([])

    ts, eph = _ensure_loaded()
    obs = eph["earth"] + wgs84.latlon(lat, lon)
    moon = eph["moon"]

    t_arr = ts.from_datetimes([_local_to_utc(t, offset_seconds)
                               for t in local_times])
    alt = obs.at(t_arr).observe(moon).apparent().altaz()[0].degrees
    illum = almanac.fraction_illuminated(eph, "moon", t_arr)

    return np.asarray(alt, dtype=float), np.asarray(illum, dtype=float)
