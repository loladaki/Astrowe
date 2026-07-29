"""Passagens visíveis da ISS — o único objeto feito pelo homem que vale a olho
nu. O TLE vem do Celestrak (cache diária); a propagação é SGP4, via Skyfield.

Degradação graciosa: se o TLE não vier (rede em baixo), devolve-se [] e a
previsão sai na mesma, apenas sem passagens da ISS.
"""
from __future__ import annotations

import logging
from datetime import date

import httpx
from skyfield.api import EarthSatellite, wgs84

from app.astro import _ensure_loaded, _local_to_utc, _utc_to_local
from app.objects import compass_point

logger = logging.getLogger(__name__)

# CATNR 25544 = ISS (ZARYA).
ISS_TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"

MIN_PASS_ALTITUDE_DEG = 15.0     # passagens rasantes não valem a pena
SUN_MAX_ALT_FOR_VISIBLE = -3.0   # observador em crepúsculo/escuro para a ver

_tle_cache: dict = {"day": None, "lines": None}


def _parse_tle(text: str) -> tuple[str, str] | None:
    """As duas linhas de um TLE (nome + linha 1 + linha 2)."""
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    l1 = next((ln for ln in lines if ln.startswith("1 ")), None)
    l2 = next((ln for ln in lines if ln.startswith("2 ")), None)
    return (l1, l2) if l1 and l2 else None


def fetch_iss_tle() -> tuple[str, str] | None:
    """TLE da ISS, do Celestrak. Em cache por dia; None se falhar."""
    today = date.today()
    if _tle_cache["day"] == today and _tle_cache["lines"]:
        return _tle_cache["lines"]
    try:
        resp = httpx.get(ISS_TLE_URL, timeout=10.0)
        resp.raise_for_status()
        parsed = _parse_tle(resp.text)
        if parsed:
            _tle_cache.update(day=today, lines=parsed)
        return parsed
    except (httpx.HTTPError, StopIteration) as exc:
        logger.warning("Falha a obter o TLE da ISS: %s", exc)
        return None


def iss_passes(lat: float, lon: float, offset_seconds: int,
               disp_start, disp_end, tle: tuple[str, str] | None = None) -> list[dict]:
    """Passagens visíveis da ISS entre `disp_start` e `disp_end` (horas locais).

    Visível = a ISS iluminada pelo Sol e o observador já no escuro/crepúsculo.
    """
    if disp_start is None or disp_end is None:
        return []
    tle = tle or fetch_iss_tle()
    if tle is None:
        return []

    ts, eph = _ensure_loaded()
    sat = EarthSatellite(tle[0], tle[1], "ISS", ts)
    topos = wgs84.latlon(lat, lon)
    observer = eph["earth"] + topos
    diff = sat - topos

    t0 = ts.from_datetime(_local_to_utc(disp_start, offset_seconds))
    t1 = ts.from_datetime(_local_to_utc(disp_end, offset_seconds))
    times, kinds = sat.find_events(topos, t0, t1,
                                   altitude_degrees=MIN_PASS_ALTITUDE_DEG)

    def altaz(t):
        alt, az, _ = diff.at(t).altaz()
        return alt.degrees, az.degrees

    def sun_below(t):
        return observer.at(t).observe(eph["sun"]).apparent().altaz()[0].degrees \
            < SUN_MAX_ALT_FOR_VISIBLE

    passes: list[dict] = []
    cur: dict = {}
    for t, kind in zip(times, kinds):
        if kind == 0:            # nasce
            cur = {"rise": t}
        elif kind == 1:          # culmina
            cur["peak"] = t
        elif kind == 2 and "peak" in cur:   # põe-se — passagem completa
            peak = cur["peak"]
            if sat.at(peak).is_sunlit(eph) and sun_below(peak):
                p_alt, p_az = altaz(peak)
                _, r_az = altaz(cur["rise"])
                _, s_az = altaz(t)
                rise_local = _utc_to_local(cur["rise"].utc_datetime(), offset_seconds)
                set_local = _utc_to_local(t.utc_datetime(), offset_seconds)
                passes.append({
                    "start": rise_local.isoformat(timespec="minutes"),
                    "peak": _utc_to_local(peak.utc_datetime(),
                                          offset_seconds).isoformat(timespec="minutes"),
                    "end": set_local.isoformat(timespec="minutes"),
                    "peak_altitude_deg": round(p_alt),
                    "peak_direction": compass_point(p_az),
                    "rise_direction": compass_point(r_az),
                    "set_direction": compass_point(s_az),
                    "duration_min": round((set_local - rise_local).total_seconds() / 60),
                })
            cur = {}
    return passes
