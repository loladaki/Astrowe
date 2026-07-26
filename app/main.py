"""Astrowe — API FastAPI + serve o frontend estático."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import lightpollution, openmeteo, score

# Lê LIGHTPOLLUTIONMAP_API_KEY de um .env na raiz do projeto, se existir.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger(__name__)

app = FastAPI(title="Astrowe", description="Nightly astronomy observing score")

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


@app.middleware("http")
async def revalidate_static(request, call_next):
    """Obriga o browser a revalidar o HTML/JS/CSS a cada visita.

    Os ficheiros mudam mas mantêm o nome (`/app.js`, `/style.css`), por isso sem
    isto o browser servia versões antigas em cache e o site parecia partido a
    quem já cá tinha estado. `no-cache` não impede a cache — impede usá-la sem
    perguntar ao servidor, que responde 304 quando nada mudou (barato).
    """
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/forecast")
async def forecast(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    mode: Literal["deepsky", "planetary"] = "deepsky",
):
    """Score de observação para as próximas ~7 noites nesta localização.

    `mode` escolhe o perfil de pesos: céu profundo (exige escuridão total, Lua
    penaliza muito) ou planetas/Lua (basta o Sol posto, Lua quase indiferente).
    """
    try:
        data = await openmeteo.fetch_forecast(lat, lon)
    except (openmeteo.OpenMeteoUnavailable, httpx.HTTPError) as exc:
        # O motivo técnico vai para o log; ao utilizador só o que lhe serve.
        # Despejar a URL do pedido, como acontecia antes, não ajuda ninguém.
        logger.warning("Falha ao obter meteorologia (%s, %s): %s", lat, lon, exc)
        raise HTTPException(
            status_code=502,
            detail="The weather service is temporarily unavailable. "
                   "Try again in a minute.",
        ) from exc

    return await _score_with(data, lat, lon, mode)


class ForecastRequest(BaseModel):
    lat: float
    lon: float
    mode: Literal["deepsky", "planetary"] = "deepsky"
    weather: dict          # o JSON do Open-Meteo, obtido pelo browser


@app.post("/api/forecast")
async def forecast_post(req: ForecastRequest):
    """Como o GET, mas a meteorologia vem do *browser*.

    Assim o pedido ao Open-Meteo sai do IP de casa do utilizador (com quota
    própria) em vez do IP partilhado do Render, que esgota a quota diária do
    Open-Meteo por ser usado por milhares de apps. O servidor continua a fazer
    o Skyfield e a poluição luminosa.
    """
    if not isinstance(req.weather, dict) or "hourly" not in req.weather:
        raise HTTPException(status_code=400, detail="Invalid weather data.")
    if not (-90 <= req.lat <= 90 and -180 <= req.lon <= 180):
        raise HTTPException(status_code=400, detail="Invalid coordinates.")
    return await _score_with(req.weather, req.lat, req.lon, req.mode)


async def _score_with(data: dict, lat: float, lon: float, mode: str):
    # Degradação graciosa: sem chave da API (ou se ela falhar) devolve None e a
    # previsão sai na mesma, apenas sem o fator de poluição luminosa.
    lp = await lightpollution.fetch(lat, lon)
    return score.build_forecast(data, lat, lon, mode, lp)


@app.get("/api/health")
async def health():
    """Diagnóstico rápido: que ingredientes estão disponíveis."""
    return {
        "open_meteo": True,  # aberta, sem chave
        "light_pollution_key_configured": lightpollution.api_key_configured(),
    }


# Serve o frontend estático em / (depois das rotas /api).
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
