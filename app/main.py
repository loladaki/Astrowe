"""Astrowe — API FastAPI + serve o frontend estático."""
from __future__ import annotations

from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from app import openmeteo, score

app = FastAPI(title="Astrowe", description="Score de observação astronómica por noite")

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


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
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Open-Meteo indisponível: {exc}")
    return score.build_forecast(data, lat, lon, mode)


# Serve o frontend estático em / (depois das rotas /api).
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
