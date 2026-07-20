"""Poluição luminosa via lightpollutionmap.info (World Atlas 2015).

A API exige uma chave pessoal — pede-se por email a Jurij Stare, o dono do
site (starej@t-2.net). É lida da variável de ambiente
`LIGHTPOLLUTIONMAP_API_KEY`; sem ela o Astrowe continua a funcionar, apenas
sem o fator de poluição luminosa.

Conversão validada contra o DeepskyLog (github.com/DeepskyLog/DeepskyLog) e a
tabela SQM→Bortle da laravel-astronomy-library dos mesmos autores.
"""
from __future__ import annotations

import math
import os

import httpx

QUERY_URL = "https://www.lightpollutionmap.info/QueryRaster/"
API_KEY_ENV = "LIGHTPOLLUTIONMAP_API_KEY"
LAYER_ENV = "LIGHTPOLLUTIONMAP_LAYER"

# Sky Brightness 2025: dados dez anos mais recentes que o World Atlas 2015.
# O WA_2015 fica como recurso — a lista de camadas aceites pela API não está
# documentada, por isso se a preferida for recusada tentamos a antiga.
DEFAULT_LAYER = "sb_2025"
FALLBACK_LAYER = "wa_2015"

# Brilho natural do céu, em mcd/m², somado ao artificial antes de converter.
# Valor tirado do próprio código do lightpollutionmap.info, que aplica a mesma
# conversão às camadas SB e WA_2015. Dá SQM 22.00 para céu pristino — o valor
# canónico. (O DeepskyLog usa 0.132025599479675, que produz 22.28 e faz a
# própria biblioteca deles rejeitar o resultado por ser > 22.)
NATURAL_SKY_BRIGHTNESS = 0.171168465

# SQM (mag/arcsec²) = log10(brilho_total / 108000000) / −0.4
SQM_SCALE = 108_000_000.0

# SQM → Bortle. Primeiro limiar que o SQM não ultrapassa ganha; acima de
# todos é Bortle 1 (céu pristino).
BORTLE_THRESHOLDS = [
    (17.5, 9), (18.0, 8), (18.5, 7), (19.1, 6),
    (20.4, 5), (21.3, 4), (21.5, 3), (21.7, 2),
]

# A poluição luminosa não muda de noite para noite: uma consulta por sítio
# chega, e a chave gratuita tem limite diário de pedidos.
_cache: dict[tuple[float, float], dict | None] = {}
CACHE_PRECISION = 3  # ~100 m


def sqm_from_artificial(artificial_mcd_m2: float) -> float:
    """Brilho artificial (mcd/m²) → SQM em mag/arcsec²."""
    total = artificial_mcd_m2 + NATURAL_SKY_BRIGHTNESS
    return math.log10(total / SQM_SCALE) / -0.4


def bortle_from_sqm(sqm: float) -> int:
    for threshold, bortle in BORTLE_THRESHOLDS:
        if sqm <= threshold:
            return bortle
    return 1


def api_key_configured() -> bool:
    return bool(os.environ.get(API_KEY_ENV, "").strip())


async def _query_layer(client: httpx.AsyncClient, layer: str,
                       lat: float, lon: float, key: str) -> float:
    """Brilho artificial (mcd/m²) nesta camada. Levanta em caso de falha."""
    params = {"ql": layer, "qt": "point", "qd": f"{lon},{lat}", "key": key}
    resp = await client.get(QUERY_URL, params=params)
    resp.raise_for_status()
    # A resposta é um número simples (por vezes entre aspas).
    return float(resp.text.strip().strip('"'))


async def fetch(lat: float, lon: float) -> dict | None:
    """Poluição luminosa neste ponto, ou None se indisponível.

    Tenta a camada preferida e recua para a antiga se falhar. Devolve None
    (sem levantar exceção) quando não há chave ou tudo falha — a previsão deve
    continuar a funcionar sem este ingrediente.
    """
    cache_key = (round(lat, CACHE_PRECISION), round(lon, CACHE_PRECISION))
    if cache_key in _cache:
        return _cache[cache_key]

    key = os.environ.get(API_KEY_ENV, "").strip()
    if not key:
        return None

    preferred = os.environ.get(LAYER_ENV, "").strip() or DEFAULT_LAYER
    layers = [preferred] + ([FALLBACK_LAYER] if preferred != FALLBACK_LAYER else [])

    result = None
    async with httpx.AsyncClient(timeout=15.0) as client:
        for layer in layers:
            try:
                artificial = await _query_layer(client, layer, lat, lon, key)
            except (httpx.HTTPError, ValueError):
                continue
            if artificial < 0:  # sentinela de "sem dados" do raster
                continue
            sqm = sqm_from_artificial(artificial)
            result = {
                "artificial_mcd_m2": round(artificial, 4),
                "sqm": round(sqm, 2),
                "bortle": bortle_from_sqm(sqm),
                "source": f"lightpollutionmap.info ({layer})",
            }
            break

    _cache[cache_key] = result
    return result
