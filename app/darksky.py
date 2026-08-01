"""Sugerir um sítio mais escuro por perto — a "cunha" do Astrowe.

A partir de um ponto, amostra alguns candidatos em anéis à volta, consulta a
poluição luminosa de cada um (reutilizando `lightpollution.fetch`, que faz cache
e degrada em silêncio) e devolve os mais escuros — com distância e direção.

Notas de custo: os candidatos são poucos e a poluição luminosa é estática, por
isso a cache do `lightpollution` absorve a maior parte dos pedidos repetidos. A
concorrência é limitada para não martelar a API do lightpollutionmap.info.
"""
from __future__ import annotations

import asyncio
import math

import httpx

from app import lightpollution
from app.objects import compass_point

EARTH_R_KM = 6371.0

# Anéis (fração do raio) × direções: 4 × 8 = 32 candidatos. Anéis mais próximos
# (~1/4 do raio) dão opções PERTO — o objetivo é o trade-off distância×escuridão,
# não só o sítio mais escuro (que fica longe).
RING_FRACTIONS = (0.25, 0.5, 0.75, 1.0)
BEARINGS = tuple(range(0, 360, 45))     # N, NE, E, SE, S, SW, W, NW

MIN_SQM_GAIN = 0.15     # ganho mínimo sobre a origem (~1 nível de Bortle no meio da escala)
MAX_SUGGESTIONS = 5
FETCH_CONCURRENCY = 8   # pedidos simultâneos ao lightpollutionmap.info (cliente partilhado)


def destination(lat: float, lon: float, bearing_deg: float, dist_km: float) -> tuple[float, float]:
    """Ponto a `dist_km` de (lat, lon) na direção `bearing_deg` (fórmula esférica)."""
    br = math.radians(bearing_deg)
    lat1, lon1 = math.radians(lat), math.radians(lon)
    dr = dist_km / EARTH_R_KM
    lat2 = math.asin(math.sin(lat1) * math.cos(dr)
                     + math.cos(lat1) * math.sin(dr) * math.cos(br))
    lon2 = lon1 + math.atan2(math.sin(br) * math.sin(dr) * math.cos(lat1),
                             math.cos(dr) - math.sin(lat1) * math.sin(lat2))
    return math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distância em km entre dois pontos (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Rumo inicial de (lat1, lon1) para (lat2, lon2), em graus (0 = norte)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def candidate_points(lat: float, lon: float, radius_km: float) -> list[tuple[float, float]]:
    """Os pontos a sondar: anéis à volta da origem."""
    return [destination(lat, lon, br, radius_km * frac)
            for frac in RING_FRACTIONS for br in BEARINGS]


async def darker_nearby(lat: float, lon: float, radius_km: float = 30.0) -> dict:
    """Sítios mais escuros do que a origem, dentro de `radius_km`.

    Devolve a poluição luminosa da origem, o raio e até `MAX_SUGGESTIONS`
    sugestões (mais escuras primeiro, depois mais perto), espalhadas para não
    apontarem todas para o mesmo sítio. Lista vazia = nada claramente mais
    escuro por perto (a origem já é boa, ou faltam dados).
    """
    cands = candidate_points(lat, lon, radius_km)
    sem = asyncio.Semaphore(FETCH_CONCURRENCY)

    # Um cliente HTTP partilhado (keep-alive) para todos os pontos — muito mais
    # rápido do que abrir uma ligação TLS por candidato.
    async with httpx.AsyncClient(timeout=15.0) as client:
        async def fetch(cy: float, cx: float):
            async with sem:
                return await lightpollution.fetch(cy, cx, client=client)

        origin, *lps = await asyncio.gather(
            fetch(lat, lon), *(fetch(cy, cx) for cy, cx in cands))

    origin_sqm = origin["sqm"] if origin else None
    origin_bortle = origin["bortle"] if origin else None

    scored = []
    for (cy, cx), lp in zip(cands, lps):
        if not lp:
            continue
        # Mais escuro = SQM maior. Só interessa se ganhar o suficiente sobre a origem.
        if origin_sqm is not None and lp["sqm"] < origin_sqm + MIN_SQM_GAIN:
            continue
        scored.append({
            "lat": round(cy, 4), "lon": round(cx, 4),
            "bortle": lp["bortle"], "sqm": lp["sqm"],
            "description": lp["description"],
            "distance_km": round(haversine_km(lat, lon, cy, cx)),
            "direction": compass_point(bearing_deg(lat, lon, cy, cx)),
            "bortle_gain": (origin_bortle - lp["bortle"]) if origin_bortle else None,
        })

    return {"origin": origin, "radius_km": radius_km,
            "suggestions": _pareto_frontier(scored)}


def _pareto_frontier(scored: list[dict]) -> list[dict]:
    """O compromisso distância × escuridão, não só os mais escuros.

    Percorre por distância crescente e guarda um ponto só se for mais escuro do
    que tudo o que está mais perto (skyline). Dá um menu do tipo "12 km → Bortle
    3, 24 km → Bortle 2, 40 km → Bortle 1": para cada distância, o mais escuro
    que se alcança, sem opções dominadas (mais longe E mais claras).
    """
    scored.sort(key=lambda s: (s["distance_km"], -s["sqm"]))
    frontier: list[dict] = []
    best_sqm = float("-inf")
    for s in scored:
        if s["sqm"] > best_sqm + 1e-9:   # mais escuro que qualquer um mais perto
            frontier.append(s)
            best_sqm = s["sqm"]
        if len(frontier) >= MAX_SUGGESTIONS:
            break
    return frontier
