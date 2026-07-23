"""Cliente da API Open-Meteo (meteorologia aberta, sem chave).

Vamos à *fonte* dos dados, não aos intermediários (Clear Outside / Meteoblue).
Docs: https://open-meteo.com/en/docs
"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# A API tem soluços passageiros (503/504). Não vale a pena estragar a previsão
# por causa de um — tenta outra vez antes de desistir.
TRANSIENT_STATUS = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 3
BACKOFF_BASE_S = 0.6

# Cache no servidor. Previsões meteorológicas não mudam ao minuto, por isso
# guardamos por localização e reaproveitamos — corta os pedidos repetidos
# (trocar de modo, comparar locais, re-tentativas) e a pegada no IP partilhado
# do Render, que é o que o Open-Meteo limita.
FRESH_TTL_S = 20 * 60          # 20 min: enquanto fresca, nem tocamos na rede
STALE_TTL_S = 6 * 60 * 60      # até 6 h: serve-se em vez de falhar
CACHE_PRECISION = 2            # ~1 km — pontos próximos partilham previsão
_cache: dict[tuple, tuple[float, dict]] = {}   # chave -> (timestamp, payload)


class OpenMeteoUnavailable(Exception):
    """A API falhou depois de todas as tentativas e sem cache utilizável."""

# Variáveis horárias que interessam à observação astronómica.
HOURLY_VARS = [
    # Entram no score
    "cloud_cover",          # nuvens total (%)
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "relative_humidity_2m", # humidade (%)
    "dew_point_2m",         # ponto de orvalho (°C) — spread = transparência
    "temperature_2m",       # temperatura (°C)
    # Contexto para quem quer interpretar os dados por si
    "visibility",           # visibilidade (m)
    "wind_speed_10m",       # vento à superfície (km/h) — estabilidade do tripé
    "wind_gusts_10m",       # rajadas (km/h)
    "wind_speed_250hPa",    # jet stream (km/h) — melhor indicador de seeing
    "precipitation_probability",
]


def request_params(lat: float, lon: float, days: int = 7) -> dict:
    """Os parâmetros do pedido — partilhados pelo servidor e pelo browser.

    `timezone=auto` é essencial: sem isto os tempos vêm em UTC e a "noite"
    aparece trocada. Com `auto`, os tempos horários vêm já em hora local
    (naive ISO) e o payload inclui `utc_offset_seconds` e `timezone`.
    """
    return {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(HOURLY_VARS),
        "timezone": "auto",
        "forecast_days": days,
    }


def _cache_key(lat: float, lon: float, days: int):
    return (round(lat, CACHE_PRECISION), round(lon, CACHE_PRECISION), days)


async def fetch_forecast(lat: float, lon: float, days: int = 7) -> dict:
    """Devolve o JSON bruto do Open-Meteo, com cache e degradação graciosa.

    Ordem: cache fresca → rede (com re-tentativas) → cache velha → erro. Servir
    uma previsão de há uns minutos é sempre melhor do que não servir nada.
    """
    key = _cache_key(lat, lon, days)
    now = time.time()

    cached = _cache.get(key)
    if cached and now - cached[0] < FRESH_TTL_S:
        return cached[1]

    params = request_params(lat, lon, days)
    motivo = "desconhecido"
    async with httpx.AsyncClient(timeout=20.0) as client:
        for tentativa in range(MAX_ATTEMPTS):
            try:
                resp = await client.get(OPEN_METEO_URL, params=params)
                if resp.status_code not in TRANSIENT_STATUS:
                    resp.raise_for_status()
                    data = resp.json()
                    _cache[key] = (now, data)
                    return data
                motivo = f"HTTP {resp.status_code}"
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                motivo = type(exc).__name__
            except httpx.HTTPError as exc:
                motivo = str(exc)
                break  # erro não transitório (400, 404…): insistir não ajuda

            if tentativa < MAX_ATTEMPTS - 1:
                espera = BACKOFF_BASE_S * (2 ** tentativa)
                logger.warning("Open-Meteo %s, nova tentativa em %.1fs (%d/%d)",
                               motivo, espera, tentativa + 2, MAX_ATTEMPTS)
                await asyncio.sleep(espera)

    # A rede falhou. Antes de desistir, serve a última previsão conhecida.
    if cached and now - cached[0] < STALE_TTL_S:
        idade_min = (now - cached[0]) / 60
        logger.warning("Open-Meteo %s; a servir cache de há %.0f min", motivo, idade_min)
        return cached[1]

    raise OpenMeteoUnavailable(motivo)
