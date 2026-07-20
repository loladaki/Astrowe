"""Modelos Pydantic para a resposta da API."""
from __future__ import annotations

from pydantic import BaseModel


class NightScore(BaseModel):
    date: str                            # dia local em que a noite começa
    score: int                           # 0–100
    verdict: str                         # "Excelente" / "Boa" / "Razoável" / "Fraca"

    # A melhor janela contígua de observação — o coração da resposta.
    window_start: str | None             # hora local ISO
    window_end: str | None
    window_hours: float | None

    # A noite disponível (escuridão astronómica, ou pôr→nascer do Sol).
    night_start: str | None
    night_end: str | None
    night_hours: float | None

    cloud_cover_pct: float | None        # nuvens médias durante a janela
    transparency: str                    # "boa" / "razoável" / "fraca"
    moon_illumination_pct: float         # fração iluminada da Lua (0–100)
    moon_max_altitude_deg: float | None  # altura máxima da Lua durante a noite

    details: str                         # frase legível para humanos


class ForecastResponse(BaseModel):
    latitude: float
    longitude: float
    timezone: str
    mode: str                            # "deepsky" | "planetary"
    mode_label: str
    generated_at: str                    # ISO UTC
    summary: str                         # o julgamento de topo
    nights: list[NightScore]
