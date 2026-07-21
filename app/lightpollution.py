"""Poluição luminosa via lightpollutionmap.info (World Atlas 2015).

A API exige uma chave pessoal — pede-se por email a Jurij Stare, o dono do
site (starej@t-2.net). É lida da variável de ambiente
`LIGHTPOLLUTIONMAP_API_KEY`; sem ela o Astrowe continua a funcionar, apenas
sem o fator de poluição luminosa.

Conversão validada contra o DeepskyLog (github.com/DeepskyLog/DeepskyLog) e a
tabela SQM→Bortle da laravel-astronomy-library dos mesmos autores.
"""
from __future__ import annotations

import logging
import math
import os

import httpx

logger = logging.getLogger(__name__)

# Endpoint documentado em /api-html/doc-rasterquery.html. O antigo
# (/QueryRaster/) ainda responde para wa_2015 mas dá HTTP 500 para sb_*.
QUERY_URL = "https://www.lightpollutionmap.info/api/queryraster"
API_KEY_ENV = "LIGHTPOLLUTIONMAP_API_KEY"
LAYER_ENV = "LIGHTPOLLUTIONMAP_LAYER"

# A API devolve erros em texto simples com HTTP 200 — não dá para confiar no
# código de estado. Estes são fatais: tentar outra camada não ajuda.
FATAL_ERROR_MARKERS = ("authentication", "quota")

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


def bortle_phrase(bortle: int) -> str:
    """Bortle em português corrente — o número sozinho não diz nada a ninguém."""
    if bortle <= 2:
        return "céu muito escuro"
    if bortle == 3:
        return "céu escuro"
    if bortle == 4:
        return "céu rural, pouca luz"
    if bortle == 5:
        return "céu suburbano"
    if bortle <= 7:
        return "muita luz à volta"
    return "céu urbano, muito poluído"


def bortle_from_sqm(sqm: float) -> int:
    for threshold, bortle in BORTLE_THRESHOLDS:
        if sqm <= threshold:
            return bortle
    return 1


def api_key_configured() -> bool:
    return bool(os.environ.get(API_KEY_ENV, "").strip())


class LightPollutionError(Exception):
    """Erro devolvido pela API em texto simples (com HTTP 200)."""

    def __init__(self, message: str, fatal: bool):
        super().__init__(message)
        self.fatal = fatal


async def _query_layer(client: httpx.AsyncClient, layer: str,
                       lat: float, lon: float, key: str) -> float:
    """Brilho artificial (mcd/m²) nesta camada.

    A API sinaliza erros com texto simples e HTTP 200 ("Invalid
    authentication.", "Daily quota exceeded."), por isso é o corpo que decide,
    não o código de estado.
    """
    params = {"ql": layer, "qt": "point", "qd": f"{lon},{lat}", "key": key}
    resp = await client.get(QUERY_URL, params=params)
    resp.raise_for_status()

    body = resp.text.strip().strip('"')
    try:
        return float(body)
    except ValueError:
        fatal = any(m in body.lower() for m in FATAL_ERROR_MARKERS)
        raise LightPollutionError(body[:200], fatal) from None


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
            except LightPollutionError as exc:
                logger.warning("lightpollutionmap (%s): %s", layer, exc)
                if exc.fatal:
                    break  # chave inválida ou quota esgotada: não insistir
                continue
            except httpx.HTTPError as exc:
                logger.warning("lightpollutionmap (%s) falhou: %s", layer, exc)
                continue
            if artificial < 0:  # sentinela de "sem dados" do raster
                logger.warning("lightpollutionmap (%s): sem dados neste ponto", layer)
                continue
            sqm = sqm_from_artificial(artificial)
            bortle = bortle_from_sqm(sqm)
            result = {
                "artificial_mcd_m2": round(artificial, 4),
                "sqm": round(sqm, 2),
                "bortle": bortle,
                "description": bortle_phrase(bortle),
                "source": f"lightpollutionmap.info ({layer})",
            }
            break

    _cache[cache_key] = result
    return result
