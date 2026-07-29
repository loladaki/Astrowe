"""Passagens visíveis da ISS — o único objeto feito pelo homem que vale a olho
nu. O TLE vem do Celestrak (cache diária); a propagação é SGP4, via Skyfield.

Degradação graciosa: se o TLE não vier (rede em baixo), devolve-se [] e a
previsão sai na mesma, apenas sem passagens da ISS.
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta

import httpx
from skyfield.api import EarthSatellite, wgs84

from app.astro import (SUNSET_DEG, _ensure_loaded, _local_to_utc, _utc_to_local,
                       compute_windows)
from app.objects import compass_point

logger = logging.getLogger(__name__)

# Fontes do TLE da ISS (CATNR 25544 = ISS ZARYA), por ordem de preferência.
# Duas fontes em hosts diferentes: se uma bloquear o IP do Render (ou estiver em
# baixo), a outra safa. Ambas devolvem o bloco de 3 linhas (nome + linha 1 + 2).
ISS_TLE_SOURCES = (
    "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE",
    "https://api.wheretheiss.at/v1/satellites/25544/tles?format=text",
)

# User-Agent próprio (boa cidadania; alguns hosts recusam UAs de biblioteca).
USER_AGENT = "Astrowe/1.0 (+https://astrowe.onrender.com; astrowe.info@gmail.com)"

MIN_PASS_ALTITUDE_DEG = 15.0     # passagens rasantes não valem a pena
SUN_MAX_ALT_FOR_VISIBLE = -3.0   # observador em crepúsculo/escuro para a ver

# Até quantos dias à frente procurar a próxima passagem quando não há nenhuma na
# janela de 7 noites. Chega para apanhar o regresso da temporada; mais longe que
# isto o TLE já não é fiável (a data sairia errada).
OUTLOOK_HORIZON_DAYS = 16

FETCH_TIMEOUT_S = 5.0            # curto: uma fonte lenta não deve pendurar o pedido
FAIL_COOLDOWN_S = 900.0         # após falhar, esperar 15 min antes de voltar a tentar

_tle_cache: dict = {"day": None, "lines": None, "last_fail": None}


def _parse_tle(text: str) -> tuple[str, str] | None:
    """As duas linhas de um TLE (nome + linha 1 + linha 2)."""
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    l1 = next((ln for ln in lines if ln.startswith("1 ")), None)
    l2 = next((ln for ln in lines if ln.startswith("2 ")), None)
    return (l1, l2) if l1 and l2 else None


def _http_get_tle(url: str) -> str:
    """GET do texto de um TLE, forçando IPv4 e com User-Agent próprio.

    ⚠️ IPv4 forçado (`local_address="0.0.0.0"`): em datacenters como o Render, o
    domínio resolvia para IPv6 sem rota e a ligação ficava pendurada até ao
    timeout (o `timed out` que fazia a ISS nunca aparecer em produção). Vincular
    o socket a IPv4 evita esse impasse.
    """
    transport = httpx.HTTPTransport(local_address="0.0.0.0")
    with httpx.Client(timeout=FETCH_TIMEOUT_S, transport=transport,
                      headers={"User-Agent": USER_AGENT},
                      follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.text


def fetch_iss_tle() -> tuple[str, str] | None:
    """TLE da ISS. Em cache por dia; tenta cada fonte por ordem; None se todas falharem.

    Cache negativa: depois de todas falharem, não voltar a tentar durante
    `FAIL_COOLDOWN_S`. Sem isto, uma indisponibilidade das fontes fazia cada
    pedido pendurar o timeout completo (e antes bloqueava o event loop).
    """
    today = date.today()
    if _tle_cache["day"] == today and _tle_cache["lines"]:
        return _tle_cache["lines"]
    last_fail = _tle_cache["last_fail"]
    if last_fail is not None and (time.monotonic() - last_fail) < FAIL_COOLDOWN_S:
        return None
    for url in ISS_TLE_SOURCES:
        try:
            parsed = _parse_tle(_http_get_tle(url))
            if parsed:
                _tle_cache.update(day=today, lines=parsed, last_fail=None)
                return parsed
            logger.warning("TLE da ISS de %s veio ilegível", url)
        except httpx.HTTPError as exc:
            logger.warning("Falha a obter o TLE da ISS de %s: %s", url, exc)
    _tle_cache["last_fail"] = time.monotonic()
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


def next_visible_pass(lat: float, lon: float, offset_seconds: int,
                      start_date: date, after: datetime,
                      horizon_days: int = OUTLOOK_HORIZON_DAYS,
                      tle: tuple[str, str] | None = None) -> dict | None:
    """A próxima passagem visível a partir de `start_date`, até `horizon_days`.

    Varre noite a noite (janela pôr→nascer do Sol) e devolve a primeira passagem
    que comece depois de `after` (hora local). None se não houver nenhuma no
    horizonte — a ISS está fora da temporada de visibilidade deste sítio.

    ⚠️ A data/hora é **aproximada** a semanas de distância: o TLE envelhece e a
    propagação SGP4 acumula erro. Serve para "por volta de quando volta", não
    para cronometrar.
    """
    tle = tle or fetch_iss_tle()
    if tle is None:
        return None
    dates = [start_date + timedelta(days=i) for i in range(horizon_days + 1)]
    windows = compute_windows(lat, lon, offset_seconds, dates, SUNSET_DEG)
    for d in dates:
        sun_set, sun_rise = windows.get(d, (None, None))
        if sun_set is None:
            continue
        for p in iss_passes(lat, lon, offset_seconds, sun_set, sun_rise, tle=tle):
            if datetime.fromisoformat(p["start"]) > after:
                return p
    return None
