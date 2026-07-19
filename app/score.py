"""O coração do Astrowe: combina meteorologia (Open-Meteo) com efemérides
(Skyfield) num score de observação por noite.

A fórmula é deliberadamente simples e transparente — é o sítio certo para iterar.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app import astro
from app.models import ForecastResponse, NightScore

# Pesos da fórmula (v1). Ajustar aqui à medida que se ganha intuição.
MOON_WEIGHT = 0.6   # quanto uma Lua cheia e no céu toda a noite corta ao score


def _mean(values: list) -> float | None:
    nums = [v for v in values if v is not None]
    return sum(nums) / len(nums) if nums else None


def _transparency(humidity: float | None) -> tuple[str, float]:
    """Rótulo + fator multiplicativo a partir da humidade média (proxy)."""
    if humidity is None:
        return "razoável", 0.95
    if humidity < 70:
        return "boa", 1.0
    if humidity < 85:
        return "razoável", 0.92
    return "fraca", 0.82


def _verdict(score: int) -> str:
    if score >= 75:
        return "Excelente"
    if score >= 55:
        return "Boa"
    if score >= 35:
        return "Razoável"
    return "Fraca"


def _score_night(cloud: float | None, illum: float, moon_up: float,
                 humidity: float | None) -> int:
    cloud_val = 100.0 if cloud is None else cloud
    cloud_score = 100.0 - cloud_val

    moon_interference = (illum / 100.0) * moon_up          # 0–1
    moon_factor = 1.0 - MOON_WEIGHT * moon_interference

    _, transparency_factor = _transparency(humidity)

    score = cloud_score * moon_factor * transparency_factor
    return int(round(max(0.0, min(100.0, score))))


def _parse_hourly(data: dict):
    h = data["hourly"]
    times = [datetime.fromisoformat(t) for t in h["time"]]
    return times, h


def build_forecast(data: dict, lat: float, lon: float) -> ForecastResponse:
    times, h = _parse_hourly(data)
    offset = int(data.get("utc_offset_seconds", 0))
    tzname = data.get("timezone", "UTC")

    dates = sorted({t.date() for t in times})
    nights_astro = astro.compute_nights(lat, lon, offset, dates)

    nights: list[NightScore] = []
    for d in dates:
        na = nights_astro.get(d, {})
        dusk, dawn = na.get("dusk"), na.get("dawn")

        if dusk is None or dawn is None:
            nights.append(NightScore(
                date=d.isoformat(), score=0, verdict="Sem noite astronómica",
                cloud_cover_pct=None, humidity_pct=None, transparency="—",
                moon_illumination_pct=round(na.get("illum", 0.0), 1),
                moon_up_fraction=round(na.get("moon_up_fraction", 0.0), 2),
                dark_start=None, dark_end=None, dark_hours=None,
                details="O Sol nunca desce abaixo de −18° nesta noite (sem escuridão total).",
            ))
            continue

        # Médias meteorológicas dentro da janela escura.
        idx = [i for i, t in enumerate(times) if dusk <= t <= dawn]
        cloud = _mean([h["cloud_cover"][i] for i in idx])
        humidity = _mean([h["relative_humidity_2m"][i] for i in idx])

        illum = na["illum"]
        moon_up = na["moon_up_fraction"]
        score = _score_night(cloud, illum, moon_up, humidity)
        transparency_label, _ = _transparency(humidity)

        cloud_txt = "—" if cloud is None else f"{round(cloud)}%"
        moon_where = "acima do horizonte" if moon_up > 0.3 else "quase sempre abaixo do horizonte"
        details = (f"Nuvens {cloud_txt}, Lua {round(illum)}% iluminada e "
                   f"{moon_where}. Escuridão das "
                   f"{dusk.strftime('%H:%M')} às {dawn.strftime('%H:%M')}.")

        nights.append(NightScore(
            date=d.isoformat(),
            score=score,
            verdict=_verdict(score),
            cloud_cover_pct=None if cloud is None else round(cloud, 1),
            humidity_pct=None if humidity is None else round(humidity, 1),
            transparency=transparency_label,
            moon_illumination_pct=round(illum, 1),
            moon_up_fraction=round(moon_up, 2),
            dark_start=dusk.isoformat(timespec="minutes"),
            dark_end=dawn.isoformat(timespec="minutes"),
            dark_hours=round(na["dark_hours"], 1),
            details=details,
        ))

    summary = _build_summary(nights)
    return ForecastResponse(
        latitude=lat, longitude=lon, timezone=tzname,
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        summary=summary, nights=nights,
    )


def _build_summary(nights: list[NightScore]) -> str:
    scored = [n for n in nights if n.score > 0]
    if not scored:
        return "Nenhuma noite com condições utilizáveis nos próximos dias."
    best = max(scored, key=lambda n: n.score)
    weekday = datetime.fromisoformat(best.date).strftime("%A")
    return (f"A melhor noite é {weekday} ({best.date}) — score {best.score}/100. "
            f"{best.details}")
