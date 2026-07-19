"""Efemérides locais com Skyfield: janela de escuridão astronómica e Lua.

Tudo calculado offline (determinístico). Na primeira execução o Skyfield
descarrega `de421.bsp` (~17 MB) para a pasta de trabalho e fica em cache.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import numpy as np
from skyfield import almanac
from skyfield.api import load, wgs84

# Sol a −18° = crepúsculo/amanhecer astronómico (céu verdadeiramente escuro).
ASTRONOMICAL_TWILIGHT_DEG = -18.0

_ts = None
_eph = None


def _ensure_loaded():
    """Carrega (uma vez) a timescale e as efemérides."""
    global _ts, _eph
    if _eph is None:
        _ts = load.timescale()
        _eph = load("de421.bsp")
    return _ts, _eph


def _to_local_naive(dt_utc: datetime, offset_seconds: int) -> datetime:
    """Converte um datetime UTC (aware) para hora local naive.

    Usamos um offset fixo (o de `utc_offset_seconds` do Open-Meteo). Ignora
    uma eventual mudança de DST dentro da janela de 7 dias — aceitável no MVP,
    e mantém a hora alinhada com os tempos locais do Open-Meteo.
    """
    return (dt_utc + timedelta(seconds=offset_seconds)).replace(tzinfo=None)


def _night_window(ts, obs, sun, t0, t1):
    """Devolve (dusk_utc, dawn_utc) — Sol a cruzar −18° na descida e na subida.

    Qualquer um pode ser None em latitudes altas onde não há noite astronómica.
    """
    set_t, _ = almanac.find_settings(obs, sun, t0, t1,
                                     horizon_degrees=ASTRONOMICAL_TWILIGHT_DEG)
    rise_t, _ = almanac.find_risings(obs, sun, t0, t1,
                                     horizon_degrees=ASTRONOMICAL_TWILIGHT_DEG)

    dusk = set_t[0].utc_datetime() if len(set_t) else None
    dawn = None
    if dusk is not None:
        for rt in rise_t:
            rtd = rt.utc_datetime()
            if rtd > dusk:
                dawn = rtd
                break
    return dusk, dawn


def _moon_metrics(ts, obs, moon, eph, dusk_utc: datetime, dawn_utc: datetime):
    """Fração da janela escura com a Lua acima do horizonte + iluminação (%)."""
    total_s = (dawn_utc - dusk_utc).total_seconds()
    n = max(3, int(total_s // 600))  # ~1 amostra por 10 min
    offsets = np.linspace(0.0, total_s, n)
    dts = [dusk_utc + timedelta(seconds=float(s)) for s in offsets]
    t_samples = ts.from_datetimes(dts)

    alt = obs.at(t_samples).observe(moon).apparent().altaz()[0].degrees
    moon_up_fraction = float(np.mean(alt > 0.0))

    t_mid = ts.from_datetime(dusk_utc + timedelta(seconds=total_s / 2))
    illum = float(almanac.fraction_illuminated(eph, "moon", t_mid)) * 100.0

    return moon_up_fraction, illum


def compute_nights(lat: float, lon: float, offset_seconds: int,
                   dates: list[date]) -> dict[date, dict]:
    """Para cada dia (tarde), calcula a janela escura e as métricas da Lua.

    Chave = dia local. Valor = dict com dusk/dawn (hora local naive),
    dark_hours, moon_up_fraction, illum. dusk/dawn podem ser None se não
    houver noite astronómica.
    """
    ts, eph = _ensure_loaded()
    earth, sun, moon = eph["earth"], eph["sun"], eph["moon"]
    obs = earth + wgs84.latlon(lat, lon)
    tzoff = timedelta(seconds=offset_seconds)

    out: dict[date, dict] = {}
    for d in dates:
        # Do meio-dia local deste dia ao meio-dia local do dia seguinte,
        # convertido para UTC — a noite inteira cabe nesta janela.
        local_start = datetime(d.year, d.month, d.day, 12, 0, 0)
        t0 = ts.from_datetime((local_start - tzoff).replace(tzinfo=timezone.utc))
        t1 = ts.from_datetime((local_start + timedelta(days=1) - tzoff)
                              .replace(tzinfo=timezone.utc))

        dusk_utc, dawn_utc = _night_window(ts, obs, sun, t0, t1)

        if dusk_utc is None or dawn_utc is None:
            out[d] = {
                "dusk": None, "dawn": None, "dark_hours": None,
                "moon_up_fraction": 0.0, "illum": 0.0,
            }
            continue

        moon_up_fraction, illum = _moon_metrics(ts, obs, moon, eph,
                                                dusk_utc, dawn_utc)
        out[d] = {
            "dusk": _to_local_naive(dusk_utc, offset_seconds),
            "dawn": _to_local_naive(dawn_utc, offset_seconds),
            "dark_hours": (dawn_utc - dusk_utc).total_seconds() / 3600.0,
            "moon_up_fraction": moon_up_fraction,
            "illum": illum,
        }
    return out
