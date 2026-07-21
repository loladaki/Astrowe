"""O que está no céu à hora recomendada — planetas, Lua e Messier.

Tudo calculado offline com Skyfield. O catálogo Messier vive em
`data/messier.json` (coordenadas J2000, validadas contra o SIMBAD).
"""
from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from pathlib import Path

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

# Fichas no Telescopius. A forma curta /deep-sky-objects/m-31 redirecciona
# sozinha para a página completa com os slugs do nome e do tipo.
TELESCOPIUS_DSO = "https://telescopius.com/deep-sky-objects/m-{n}"
TELESCOPIUS_PLANET = "https://telescopius.com/solar-system/planet/{slug}"
# A Lua não tem ficha própria; o calendário de fases é o que existe.
TELESCOPIUS_MOON = "https://telescopius.com/solar-system/moon-calendar"


def compass_point(azimuth_deg: float) -> str:
    return COMPASS[int((azimuth_deg % 360) / 22.5 + 0.5) % 16]


@lru_cache(maxsize=1)
def _catalog() -> list[dict]:
    with open(CATALOG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def visible_objects(lat: float, lon: float, offset_seconds: int,
                    when_local: datetime, moon_illum: float,
                    moon_alt: float, limit: int = 12) -> list[dict]:
    """O que está observável neste instante, do mais fácil ao mais difícil.

    `moon_illum` (0–1) e `moon_alt` servem para avisar quando o luar apaga os
    objectos ténues — não os escondemos, marcamo-los.
    """
    ts, eph = _ensure_loaded()
    observer = eph["earth"] + wgs84.latlon(lat, lon)
    t = ts.from_datetime(_local_to_utc(when_local, offset_seconds))

    # Luar a lavar o céu: só relevante para objectos de céu profundo.
    moonlight = moon_illum * max(0.0, moon_alt / 90.0)

    found = []

    # --- A Lua, quando está no céu ---
    # Em modo planetas é um alvo por direito próprio; em céu profundo é o
    # estorvo. Em qualquer dos casos, se está lá em cima deve constar.
    moon_apparent = observer.at(t).observe(eph["moon"]).apparent()
    m_alt, m_az, _ = moon_apparent.altaz()
    if m_alt.degrees >= MIN_ALTITUDE_BRIGHT_DEG:
        m_ra, m_dec, _ = moon_apparent.radec()
        found.append({
            "name": "Lua", "kind": "satélite", "magnitude": None,
            "altitude_deg": round(m_alt.degrees, 1),
            "azimuth_deg": round(m_az.degrees, 1),
            "direction": compass_point(m_az.degrees),
            "washed_out": False,
            "ra_h": round(m_ra.hours, 5),
            "dec_deg": round(m_dec.degrees, 4),
            "url": TELESCOPIUS_MOON,
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
        found.append({
            "name": label, "kind": "planeta", "magnitude": None,
            "altitude_deg": round(alt.degrees, 1),
            "azimuth_deg": round(az.degrees, 1),
            "direction": compass_point(az.degrees),
            "washed_out": False,
            "ra_h": round(ra.hours, 5),
            "dec_deg": round(dec.degrees, 4),
            "url": TELESCOPIUS_PLANET.format(slug=slug),
        })

    # --- Céu profundo ---
    for obj in _catalog():
        mag = obj.get("mag")
        if mag is not None and mag > MAX_MAGNITUDE:
            continue
        star = Star(ra_hours=obj["ra_h"], dec_degrees=obj["dec_deg"])
        alt, az, _ = observer.at(t).observe(star).apparent().altaz()
        if alt.degrees < MIN_ALTITUDE_DEG:
            continue
        # Regra prática: com a Lua alta e cheia, tudo abaixo de ~mag 7 desaparece.
        washed = mag is not None and moonlight > 0.25 and mag > 7.0 - 4.0 * moonlight
        found.append({
            "name": obj["id"], "kind": obj["tipo"], "magnitude": mag,
            "altitude_deg": round(alt.degrees, 1),
            "azimuth_deg": round(az.degrees, 1),
            "direction": compass_point(az.degrees),
            "washed_out": bool(washed),
            "ra_h": obj["ra_h"],
            "dec_deg": obj["dec_deg"],
            "url": TELESCOPIUS_DSO.format(n=obj["id"].lstrip("Mm")),
        })

    # Lua e planetas primeiro, depois o mais brilhante e o mais alto.
    order = {"satélite": 0, "planeta": 1}
    found.sort(key=lambda o: (order.get(o["kind"], 2),
                              o["washed_out"],
                              o["magnitude"] if o["magnitude"] is not None else -5,
                              -o["altitude_deg"]))
    return found[:limit]
