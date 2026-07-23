"""O que está no céu à hora recomendada — planetas, Lua e Messier.

Tudo calculado offline com Skyfield. O catálogo Messier vive em
`data/messier.json` (coordenadas J2000, validadas contra o SIMBAD).
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np
from skyfield.api import Star, wgs84

from app.astro import _ensure_loaded, _local_to_utc

CATALOG_PATH = Path(__file__).resolve().parent / "data" / "messier.json"

# Abaixo disto a atmosfera estraga a vista e as árvores/casas costumam tapar.
MIN_ALTITUDE_DEG = 25.0

# A Lua e os planetas são brilhantes e atravessam bem a atmosfera baixa —
# ninguém deixa de olhar para Saturno a 18°. Bar mais baixo para eles.
MIN_ALTITUDE_BRIGHT_DEG = 15.0

# Objectos mais fracos que isto não se veem num telescópio amador típico.
MAX_MAGNITUDE = 10.0

# (nome em português, chave nas efemérides, slug no Telescopius)
PLANETS = [
    ("Mercúrio", "mercury", "mercury"),
    ("Vénus", "venus", "venus"),
    ("Marte", "mars", "mars"),
    ("Júpiter", "jupiter barycenter", "jupiter"),
    ("Saturno", "saturn barycenter", "saturn"),
    ("Úrano", "uranus barycenter", "uranus"),
    ("Neptuno", "neptune barycenter", "neptune"),
]

COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"]

# Símbolos convencionais dos atlas celestes. O frontend desenha-os em SVG —
# são a notação que qualquer observador reconhece sem legenda.
SYMBOLS = {
    "galáxia": "galaxy",
    "enxame aberto": "open_cluster",
    "nuvem estelar": "open_cluster",
    "asterismo": "open_cluster",
    "enxame globular": "globular",
    "nebulosa planetária": "planetary",
    "nebulosa": "nebula",
    "remanescente de supernova": "nebula",
    "estrela dupla": "double",
    "planeta": "planet",
    "satélite": "moon",
}

# Fichas no Telescopius. A forma curta /deep-sky-objects/m-31 redirecciona
# sozinha para a página completa com os slugs do nome e do tipo.
TELESCOPIUS_DSO = "https://telescopius.com/deep-sky-objects/m-{n}"
TELESCOPIUS_PLANET = "https://telescopius.com/solar-system/planet/{slug}"
# A Lua não tem ficha própria; o calendário de fases é o que existe.
TELESCOPIUS_MOON = "https://telescopius.com/solar-system/moon-calendar"


# Uma hora sideral é mais curta que uma solar: a Terra dá a volta em 23h56m.
SIDEREAL_TO_SOLAR = 0.9972695663


def compass_point(azimuth_deg: float) -> str:
    return COMPASS[int((azimuth_deg % 360) / 22.5 + 0.5) % 16]


def airmass(altitude_deg: float) -> float | None:
    """Espessura de atmosfera atravessada — 1.0 no zénite, 2.0 a ~30°.

    Fórmula de Kasten-Young, que continua a valer perto do horizonte, ao
    contrário do simples 1/cos(z) que dispara para infinito.
    """
    if altitude_deg <= 0:
        return None
    return 1.0 / (math.sin(math.radians(altitude_deg))
                  + 0.50572 * (altitude_deg + 6.07995) ** -1.6364)


def local_sidereal_hours(t, lon_deg: float) -> float:
    """Tempo sideral local, em horas. É ele que diz o que está no meridiano."""
    return (t.gast + lon_deg / 15.0) % 24.0


def transit_altitude(lat_deg: float, dec_deg: float) -> float:
    """Altura máxima que um objecto chega a atingir nesta latitude.

    Exacta e gratuita: no meridiano, a altura é 90 − |latitude − declinação|.
    Evita ter de amostrar a noite inteira só para descobrir o pico.
    """
    return 90.0 - abs(lat_deg - dec_deg)


def hours_to_transit(lst_h: float, ra_h: float) -> float:
    """Horas solares até à culminação. Negativo = já passou o ponto alto."""
    hour_angle = ((lst_h - ra_h + 12.0) % 24.0) - 12.0
    return -hour_angle * SIDEREAL_TO_SOLAR


def altitude_series(lat_deg: float, ra_h, dec_deg, lst_start_h: float,
                    hours_ahead):
    """Altura (graus) de cada objecto em cada hora, por forma fechada.

    sin(alt) = sin φ · sin δ + cos φ · cos δ · cos H,  com H = TSL − AR.

    Amostrar isto com o Skyfield seria 110 objectos × 10 horas × 7 noites de
    observações — insuportável no plano gratuito. Assim é um produto externo
    de numpy: instantâneo, e exacto para objectos fixos.

    Devolve matriz (n_horas, n_objectos).
    """
    ra = np.atleast_1d(np.asarray(ra_h, dtype=float))
    dec = np.radians(np.atleast_1d(np.asarray(dec_deg, dtype=float)))
    dt = np.asarray(hours_ahead, dtype=float)

    # O relógio sideral adianta-se ao solar: 24h solares = 24h04m siderais.
    lst = lst_start_h + dt / SIDEREAL_TO_SOLAR
    hour_angle = np.radians((lst[:, None] - ra[None, :]) * 15.0)

    phi = math.radians(lat_deg)
    sin_alt = (math.sin(phi) * np.sin(dec)[None, :]
               + math.cos(phi) * np.cos(dec)[None, :] * np.cos(hour_angle))
    return np.degrees(np.arcsin(np.clip(sin_alt, -1.0, 1.0)))


def _round_airmass(altitude_deg: float) -> float | None:
    x = airmass(altitude_deg)
    return None if x is None else round(x, 2)


def _trend(hours: float) -> str:
    if hours > 0.25:
        return "a subir"
    if hours < -0.25:
        return "a descer"
    return "no ponto alto"


def _timing(lst_h: float, ra_h: float, dec_deg: float, lat: float,
            when_local: datetime, window_start: datetime | None,
            window_end: datetime | None) -> dict:
    """Culminação, tendência e altura máxima deste objecto."""
    to_transit = hours_to_transit(lst_h, ra_h)
    transit_at = when_local + timedelta(hours=to_transit)
    dentro = (window_start is not None and window_end is not None
              and window_start <= transit_at <= window_end)
    return {
        "trend": _trend(to_transit),
        "max_altitude_deg": round(transit_altitude(lat, dec_deg), 1),
        "transit_time": transit_at.isoformat(timespec="minutes") if dentro else None,
    }


@lru_cache(maxsize=1)
def _catalog() -> list[dict]:
    with open(CATALOG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def _catalog_vectorised():
    """Catálogo observável + um único `Star` com todas as coordenadas.

    O Skyfield aceita arrays, o que permite posicionar os 110 objectos numa
    só chamada em vez de 110 — a diferença nota-se num host modesto.
    """
    usable = [o for o in _catalog()
              if o.get("mag") is None or o["mag"] <= MAX_MAGNITUDE]
    stars = Star(ra_hours=np.array([o["ra_h"] for o in usable]),
                 dec_degrees=np.array([o["dec_deg"] for o in usable]))
    return usable, stars


def visible_objects(lat: float, lon: float, offset_seconds: int,
                    when_local: datetime, moon_illum: float,
                    moon_alt: float, limit: int = 12,
                    window_start: datetime | None = None,
                    window_end: datetime | None = None,
                    window_times: list[datetime] | None = None) -> list[dict]:
    """O que está observável neste instante, do mais fácil ao mais difícil.

    `moon_illum` (0–1) e `moon_alt` servem para avisar quando o luar apaga os
    objectos ténues — não os escondemos, marcamo-los.
    """
    ts, eph = _ensure_loaded()
    observer = eph["earth"] + wgs84.latlon(lat, lon)
    t = ts.from_datetime(_local_to_utc(when_local, offset_seconds))

    # Luar a lavar o céu: só relevante para objectos de céu profundo.
    moonlight = moon_illum * max(0.0, moon_alt / 90.0)

    lst = local_sidereal_hours(t, lon)
    timing = lambda ra, dec: _timing(lst, ra, dec, lat, when_local,
                                     window_start, window_end)

    found = []

    # --- A Lua, quando está no céu ---
    # Em modo planetas é um alvo por direito próprio; em céu profundo é o
    # estorvo. Em qualquer dos casos, se está lá em cima deve constar.
    moon_apparent = observer.at(t).observe(eph["moon"]).apparent()
    m_alt, m_az, _ = moon_apparent.altaz()
    if m_alt.degrees >= MIN_ALTITUDE_BRIGHT_DEG:
        m_ra, m_dec, _ = moon_apparent.radec()
        # Para o cálculo do trânsito é preciso o referencial *da data*: o tempo
        # sideral é da data, e J2000 está ~0.37° defasado por precessão.
        m_ra_d, m_dec_d, _ = moon_apparent.radec(epoch="date")
        found.append({
            "name": "Lua", "kind": "satélite", "magnitude": None,
            "altitude_deg": round(m_alt.degrees, 1),
            "azimuth_deg": round(m_az.degrees, 1),
            "direction": compass_point(m_az.degrees),
            "washed_out": False,
            "ra_h": round(m_ra.hours, 5),
            "dec_deg": round(m_dec.degrees, 4),
            "url": TELESCOPIUS_MOON,
            "airmass": _round_airmass(m_alt.degrees),
            "ra_date": m_ra_d.hours, "dec_date": m_dec_d.degrees,
            **timing(m_ra_d.hours, m_dec_d.degrees),
        })

    # --- Sistema solar (brilhante, não sofre com o luar) ---
    for label, key, slug in PLANETS:
        try:
            body = eph[key]
        except KeyError:
            continue
        apparent = observer.at(t).observe(body).apparent()
        alt, az, _ = apparent.altaz()
        if alt.degrees < MIN_ALTITUDE_BRIGHT_DEG:
            continue
        ra, dec, _ = apparent.radec()
        ra_d, dec_d, _ = apparent.radec(epoch="date")
        found.append({
            "name": label, "kind": "planeta", "magnitude": None,
            "altitude_deg": round(alt.degrees, 1),
            "azimuth_deg": round(az.degrees, 1),
            "direction": compass_point(az.degrees),
            "washed_out": False,
            "ra_h": round(ra.hours, 5),
            "dec_deg": round(dec.degrees, 4),
            "url": TELESCOPIUS_PLANET.format(slug=slug),
            "airmass": _round_airmass(alt.degrees),
            "ra_date": ra_d.hours, "dec_date": dec_d.degrees,
            **timing(ra_d.hours, dec_d.degrees),
        })

    # --- Céu profundo (todos de uma vez) ---
    catalog, stars = _catalog_vectorised()
    apparent_dso = observer.at(t).observe(stars).apparent()
    alt_arr, az_arr, _ = apparent_dso.altaz()
    altitudes, azimuths = alt_arr.degrees, az_arr.degrees
    # O catálogo é J2000; para o trânsito é preciso o referencial da data.
    ra_d_arr, dec_d_arr, _ = apparent_dso.radec(epoch="date")
    ras_d, decs_d = ra_d_arr.hours, dec_d_arr.degrees

    for i, obj in enumerate(catalog):
        altitude = float(altitudes[i])
        if altitude < MIN_ALTITUDE_DEG:
            continue
        mag = obj.get("mag")
        azimuth = float(azimuths[i])
        # Regra prática: com a Lua alta e cheia, tudo abaixo de ~mag 7 desaparece.
        washed = mag is not None and moonlight > 0.25 and mag > 7.0 - 4.0 * moonlight
        found.append({
            "name": obj["id"], "kind": obj["tipo"], "magnitude": mag,
            "altitude_deg": round(altitude, 1),
            "azimuth_deg": round(azimuth, 1),
            "direction": compass_point(azimuth),
            "washed_out": bool(washed),
            "ra_h": obj["ra_h"],
            "dec_deg": obj["dec_deg"],
            "url": TELESCOPIUS_DSO.format(n=obj["id"].lstrip("Mm")),
            "airmass": _round_airmass(altitude),
            "ra_date": float(ras_d[i]), "dec_date": float(decs_d[i]),
            **timing(float(ras_d[i]), float(decs_d[i])),
        })

    # Lua e planetas primeiro, depois o mais brilhante e o mais alto.
    order = {"satélite": 0, "planeta": 1}
    found.sort(key=lambda o: (order.get(o["kind"], 2),
                              o["washed_out"],
                              o["magnitude"] if o["magnitude"] is not None else -5,
                              -o["altitude_deg"]))
    found = found[:limit]

    for o in found:
        o["symbol"] = SYMBOLS.get(o["kind"], "nebula")

    if window_times:
        _attach_windows(lat, lon, offset_seconds, window_times, found)
    return found


def _attach_windows(lat: float, lon: float, offset_seconds: int,
                    window_times: list[datetime], found: list[dict]) -> None:
    """Altura de cada objecto em cada hora da janela — o plano da sessão.

    Usa as coordenadas *da data* já calculadas (`ra_date`/`dec_date`), por isso
    não arrasta o desvio da precessão. A Lua é o único caso aproximado: move-se
    ~0.5°/h em ascensão recta e aqui é tratada como fixa, o que desloca a curva
    dela alguns minutos — invisível numa barra de resolução horária.
    """
    if not found:
        return
    ts, _ = _ensure_loaded()
    t0 = ts.from_datetime(_local_to_utc(window_times[0], offset_seconds))
    lst0 = local_sidereal_hours(t0, lon)
    ahead = [(t - window_times[0]).total_seconds() / 3600.0 for t in window_times]

    alts = altitude_series(lat,
                           [o["ra_date"] for o in found],
                           [o["dec_date"] for o in found],
                           lst0, ahead)
    for j, o in enumerate(found):
        o["altitudes"] = [round(float(a), 1) for a in alts[:, j]]
        o.pop("ra_date", None)
        o.pop("dec_date", None)
