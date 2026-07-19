"""Cliente da API Open-Meteo (meteorologia aberta, sem chave).

Vamos à *fonte* dos dados, não aos intermediários (Clear Outside / Meteoblue).
Docs: https://open-meteo.com/en/docs
"""
from __future__ import annotations

import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Variáveis horárias que interessam à observação astronómica.
HOURLY_VARS = [
    "cloud_cover",          # nuvens total (%)
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "relative_humidity_2m", # humidade (%) — proxy de transparência
    "dew_point_2m",         # ponto de orvalho (°C)
    "temperature_2m",       # temperatura (°C)
    "visibility",           # visibilidade (m)
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
