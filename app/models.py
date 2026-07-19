"""Modelos Pydantic para a resposta da API."""
from __future__ import annotations

from pydantic import BaseModel


class NightScore(BaseModel):
    date: str                       # dia local da tarde/noite (a noite começa neste dia)
    score: int                      # 0–100
    verdict: str                    # "Excelente" / "Boa" / "Razoável" / "Fraca" / ...
    cloud_cover_pct: float | None   # nuvens médias durante a janela escura
    humidity_pct: float | None      # humidade relativa média (proxy de transparência)
    transparency: str               # "boa" / "razoável" / "fraca"
    moon_illumination_pct: float    # fração iluminada da Lua (0–100)
    moon_up_fraction: float         # fração da janela escura com a Lua acima do horizonte (0–1)
    dark_start: str | None          # início do crepúsculo astronómico (hora local ISO)
    dark_end: str | None            # fim (amanhecer astronómico) — hora local ISO
    dark_hours: float | None        # duração da janela escura, em horas
    details: str                    # frase legível para humanos


class ForecastResponse(BaseModel):
    latitude: float
    longitude: float
    timezone: str
    generated_at: str               # ISO UTC
    summary: str                    # "A melhor noite é ..." — o julgamento de topo
    nights: list[NightScore]
