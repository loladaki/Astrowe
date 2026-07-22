"""Cliente da API Open-Meteo (meteorologia aberta, sem chave).

Vamos à *fonte* dos dados, não aos intermediários (Clear Outside / Meteoblue).
Docs: https://open-meteo.com/en/docs
"""
from __future__ import annotations

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# A API tem soluços passageiros (503/504). Não vale a pena estragar a previsão
# por causa de um — tenta outra vez antes de desistir.
TRANSIENT_STATUS = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 3
BACKOFF_BASE_S = 0.6


class OpenMeteoUnavailable(Exception):
    """A API falhou depois de todas as tentativas."""

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


async def fetch_forecast(lat: float, lon: float, days: int = 7) -> dict:
    """Devolve o JSON bruto do Open-Meteo com os campos horários acima.

    `timezone=auto` é essencial: sem isto os tempos vêm em UTC e a "noite"
    aparece trocada. Com `auto`, os tempos horários vêm já em hora local
    (naive ISO) e o payload inclui `utc_offset_seconds` e `timezone`.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(HOURLY_VARS),
        "timezone": "auto",
        "forecast_days": days,
    }

    motivo = "desconhecido"
    async with httpx.AsyncClient(timeout=20.0) as client:
        for tentativa in range(MAX_ATTEMPTS):
            try:
                resp = await client.get(OPEN_METEO_URL, params=params)
                if resp.status_code not in TRANSIENT_STATUS:
                    resp.raise_for_status()
                    return resp.json()
                motivo = f"HTTP {resp.status_code}"
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                motivo = type(exc).__name__
            except httpx.HTTPError as exc:
                # Erro não transitório (400, 404…): insistir não ajuda.
                raise OpenMeteoUnavailable(str(exc)) from exc

            if tentativa < MAX_ATTEMPTS - 1:
                espera = BACKOFF_BASE_S * (2 ** tentativa)
                logger.warning("Open-Meteo %s — nova tentativa em %.1fs (%d/%d)",
                               motivo, espera, tentativa + 2, MAX_ATTEMPTS)
                await asyncio.sleep(espera)

    raise OpenMeteoUnavailable(motivo)
