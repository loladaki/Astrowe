"""Cliente da API Open-Meteo (meteorologia aberta, sem chave).

Vamos à *fonte* dos dados, não aos intermediários (Clear Outside / Meteoblue).
Docs: https://open-meteo.com/en/docs
"""
from __future__ import annotations

import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

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
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        return resp.json()
