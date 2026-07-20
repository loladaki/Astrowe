"""O coração do Astrowe: combina meteorologia (Open-Meteo) com efemérides
(Skyfield) num score de observação por noite.

Ideia central: em vez de fazer a média da noite toda (que esconde o que
interessa — "limpo até à 1h, depois fecha" dá a mesma média que "meio encoberto
a noite inteira"), calculamos uma **qualidade hora a hora** e procuramos a
**melhor janela contígua** de observação. O score é dessa janela.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from app import astro
from app.models import ForecastResponse, NightScore

# Pesos por camada de nuvens: as baixas tapam tudo, os cirros altos deixam
# passar bastante. Modeladas como obstruções independentes que se multiplicam.
CLOUD_LAYER_WEIGHTS = {"low": 1.0, "mid": 0.85, "high": 0.5}

# Spread temperatura − ponto de orvalho (°C): mede quão seco está o ar.
# <= 1 °C é nevoeiro/orvalho iminente; >= 9 °C é ar seco e transparente.
SPREAD_MIN = 1.0
SPREAD_MAX = 9.0

# Duração (h) a partir da qual a janela recebe crédito total. Abaixo disto o
# crédito cresce com raiz quadrada — retornos decrescentes, perfil "equilibrado".
FULL_CREDIT_HOURS = 4.0

# Tolerância para considerar dois troços equivalentes (ver _best_window).
TIE_EPSILON = 1e-6

# A janela *reportada* alarga-se para lá do troço que define o score, enquanto
# as horas vizinhas tiverem qualidade comparável. Estes limiares só afetam o
# relato (quanto céu bom tens), nunca o score — por isso não criam degraus.
REPORT_RATIO = 0.80   # fração da qualidade do troço ótimo que ainda conta
REPORT_FLOOR = 0.25   # chão absoluto, para não alargar para dentro de lixo

PROFILES = {
    "deepsky": {
        "label": "céu profundo",
        # Galáxias e nebulosas exigem escuridão real e sofrem muito com a Lua.
        "horizon_degrees": astro.ASTRONOMICAL_TWILIGHT_DEG,
        "moon_weight": 0.70,
        "transparency_floor": 0.70,
    },
    "planetary": {
        "label": "planetas e Lua",
        # Planetas veem-se no crepúsculo e a Lua não atrapalha (é o alvo!).
        "horizon_degrees": astro.SUNSET_DEG,
        "moon_weight": 0.05,
        "transparency_floor": 0.85,
    },
}
DEFAULT_MODE = "deepsky"


# ---------------------------------------------------------------- ingredientes

def _cloud_transmission(low, mid, high, total) -> float:
    """Fração de céu utilizável (0–1), pesando as camadas de nuvens.

    Trata cada camada como uma obstrução independente: 100% de cirros altos
    deixa passar metade, 100% de estratos baixos não deixa passar nada.
    """
    if low is None and mid is None and high is None:
        return 1.0 - (0.0 if total is None else total) / 100.0

    transmission = 1.0
    for value, weight in ((low, CLOUD_LAYER_WEIGHTS["low"]),
                          (mid, CLOUD_LAYER_WEIGHTS["mid"]),
                          (high, CLOUD_LAYER_WEIGHTS["high"])):
        frac = 0.0 if value is None else value / 100.0
        transmission *= 1.0 - weight * frac
    return max(0.0, min(1.0, transmission))


def _spread(temp, dew):
    return None if temp is None or dew is None else temp - dew


def _transparency_factor(spread, floor: float) -> float:
    """Fator contínuo (floor–1.0) a partir do spread do ponto de orvalho."""
    if spread is None:
        t = 0.5
    else:
        t = (spread - SPREAD_MIN) / (SPREAD_MAX - SPREAD_MIN)
        t = max(0.0, min(1.0, t))
    return floor + (1.0 - floor) * t


def _transparency_label(spread) -> str:
    if spread is None:
        return "desconhecida"
    if spread >= 6.0:
        return "boa"
    if spread >= 3.0:
        return "razoável"
    return "fraca"


def _moon_factor(illum_frac: float, alt_deg: float, weight: float) -> float:
    """Penalização contínua da Lua: pesa iluminação × altura no céu.

    `sin(altitude)` vale 0 no horizonte e 1 no zénite — uma Lua cheia rasante
    incomoda muito menos do que uma Lua cheia por cima da cabeça.
    """
    if alt_deg <= 0.0:
        return 1.0
    return 1.0 - weight * illum_frac * math.sin(math.radians(alt_deg))


def _duration_factor(hours: float) -> float:
    """Crédito total a partir de FULL_CREDIT_HOURS, com retornos decrescentes."""
    return min(1.0, hours / FULL_CREDIT_HOURS) ** 0.5


# ------------------------------------------------------------- melhor janela

def _best_window(qualities: list[float]):
    """Troço contíguo que maximiza  qualidade_média × fator_duração.

    Sem limiar arbitrário de "hora utilizável": acrescentar uma hora fraca baixa
    a média mas sobe o crédito de duração, por isso o ótimo aparece sozinho.
    Ex.: 2h impecáveis batem 6h medianas; 6h boas batem 2h boas.
    """
    n = len(qualities)
    if n == 0:
        return None

    best = None
    for i in range(n):
        total = 0.0
        for j in range(i, n):
            total += qualities[j]
            hours = float(j - i + 1)
            mean_q = total / hours
            value = mean_q * _duration_factor(hours)
            # Empate: fica com a janela mais longa. Sem isto, numa noite
            # uniformemente limpa todos os troços acima de FULL_CREDIT_HOURS
            # valem o mesmo e ficaríamos com o mais curto — a esconder céu bom.
            better = best is None or value > best["value"] + TIE_EPSILON or (
                abs(value - best["value"]) <= TIE_EPSILON and hours > best["hours"])
            if better:
                best = {"i": i, "j": j, "mean_q": mean_q,
                        "hours": hours, "value": value}
    return best


def _extend_window(qualities: list[float], best: dict) -> tuple[int, int]:
    """Alarga a janela reportada às horas vizinhas de qualidade comparável.

    O score sai do troço ótimo (que satura às FULL_CREDIT_HOURS), mas quem vai
    observar quer saber quanto tempo de céu bom tem *mesmo*. Sem isto, uma noite
    inteira impecável de 5.6h seria sempre reportada como "4h".
    """
    bar = max(REPORT_FLOOR, REPORT_RATIO * best["mean_q"])
    i, j = best["i"], best["j"]
    while i > 0 and qualities[i - 1] >= bar:
        i -= 1
    while j < len(qualities) - 1 and qualities[j + 1] >= bar:
        j += 1
    return i, j


def _verdict(score: int) -> str:
    if score >= 75:
        return "Excelente"
    if score >= 55:
        return "Boa"
    if score >= 35:
        return "Razoável"
    return "Fraca"


def _mean(values):
    nums = [v for v in values if v is not None]
    return sum(nums) / len(nums) if nums else None


# ----------------------------------------------------------------- orquestração

def _parse_hourly(data: dict):
    h = data["hourly"]
    times = [datetime.fromisoformat(t) for t in h["time"]]
    return times, h


def build_forecast(data: dict, lat: float, lon: float,
                   mode: str = DEFAULT_MODE) -> ForecastResponse:
    profile = PROFILES.get(mode, PROFILES[DEFAULT_MODE])
    times, h = _parse_hourly(data)
    offset = int(data.get("utc_offset_seconds", 0))
    tzname = data.get("timezone", "UTC")

    dates = sorted({t.date() for t in times})
    windows = astro.compute_windows(lat, lon, offset, dates,
                                    profile["horizon_degrees"])
    moon_alt, moon_illum = astro.moon_series(lat, lon, offset, times)

    nights = [
        _build_night(d, windows.get(d, (None, None)), times, h,
                     moon_alt, moon_illum, profile)
        for d in dates
    ]

    return ForecastResponse(
        latitude=lat, longitude=lon, timezone=tzname,
        mode=mode, mode_label=profile["label"],
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        summary=_build_summary(nights, profile["label"]),
        nights=nights,
    )


def _build_night(d, window, times, h, moon_alt, moon_illum, profile) -> NightScore:
    night_start, night_end = window

    if night_start is None or night_end is None:
        return NightScore(
            date=d.isoformat(), score=0, verdict="Sem noite escura",
            window_start=None, window_end=None, window_hours=None,
            night_start=None, night_end=None, night_hours=None,
            cloud_cover_pct=None, transparency="—",
            moon_illumination_pct=0.0, moon_max_altitude_deg=None,
            details="O Sol não desce o suficiente nesta noite — sem escuridão utilizável.",
        )

    idx = [i for i, t in enumerate(times) if night_start <= t <= night_end]
    if not idx:
        return NightScore(
            date=d.isoformat(), score=0, verdict="Sem dados",
            window_start=None, window_end=None, window_hours=None,
            night_start=night_start.isoformat(timespec="minutes"),
            night_end=night_end.isoformat(timespec="minutes"),
            night_hours=round((night_end - night_start).total_seconds() / 3600, 1),
            cloud_cover_pct=None, transparency="—",
            moon_illumination_pct=0.0, moon_max_altitude_deg=None,
            details="Sem previsão meteorológica para esta noite.",
        )

    floor = profile["transparency_floor"]
    weight = profile["moon_weight"]

    qualities, spreads = [], []
    for i in idx:
        transmission = _cloud_transmission(
            h["cloud_cover_low"][i], h["cloud_cover_mid"][i],
            h["cloud_cover_high"][i], h["cloud_cover"][i])
        spread = _spread(h["temperature_2m"][i], h["dew_point_2m"][i])
        spreads.append(spread)
        quality = (transmission
                   * _transparency_factor(spread, floor)
                   * _moon_factor(float(moon_illum[i]), float(moon_alt[i]), weight))
        qualities.append(quality)

    best = _best_window(qualities)
    score = int(round(max(0.0, min(100.0, 100.0 * best["value"]))))

    # Score sai do troço ótimo; a janela reportada alarga-se ao céu comparável.
    ext_i, ext_j = _extend_window(qualities, best)
    win_idx = idx[ext_i:ext_j + 1]
    win_start = times[win_idx[0]]
    # Cada amostra representa a hora que se segue; não passar do fim da noite.
    win_end = min(times[win_idx[-1]] + timedelta(hours=1), night_end)
    # Duração pelos tempos reais, não pelo nº de amostras: as pontas da noite
    # são horas parciais (a escuridão começa às 22:48, não às 23:00) e contar
    # amostras dava janelas mais longas do que a própria noite.
    win_hours = (win_end - win_start).total_seconds() / 3600.0

    cloud = _mean([h["cloud_cover"][i] for i in win_idx])
    illum_pct = float(moon_illum[idx[len(idx) // 2]]) * 100.0
    # Altura da Lua *dentro da janela escolhida* — é a que te afeta. Reportar a
    # da noite toda seria enganador quando a janela é depois da Lua se pôr.
    max_alt = max(float(moon_alt[i]) for i in win_idx)
    label = _transparency_label(_mean([s for s in spreads if s is not None]))

    cloud_txt = "—" if cloud is None else f"{round(cloud)}%"
    moon_txt = (f"Lua {round(illum_pct)}% a {round(max_alt)}° na janela"
                if max_alt > 0 else f"Lua {round(illum_pct)}% abaixo do horizonte")
    details = (f"{win_hours:.1f}h das {win_start.strftime('%H:%M')} às "
               f"{win_end.strftime('%H:%M')} · nuvens {cloud_txt} · {moon_txt} · "
               f"transparência {label}.")

    return NightScore(
        date=d.isoformat(), score=score, verdict=_verdict(score),
        window_start=win_start.isoformat(timespec="minutes"),
        window_end=win_end.isoformat(timespec="minutes"),
        window_hours=round(win_hours, 1),
        night_start=night_start.isoformat(timespec="minutes"),
        night_end=night_end.isoformat(timespec="minutes"),
        night_hours=round((night_end - night_start).total_seconds() / 3600, 1),
        cloud_cover_pct=None if cloud is None else round(cloud, 1),
        transparency=label,
        moon_illumination_pct=round(illum_pct, 1),
        moon_max_altitude_deg=round(max_alt, 1),
        details=details,
    )


def _build_summary(nights: list[NightScore], mode_label: str) -> str:
    scored = [n for n in nights if n.score > 0]
    if not scored:
        return f"Nenhuma noite com condições utilizáveis para {mode_label} nos próximos dias."
    best = max(scored, key=lambda n: n.score)
    weekday = datetime.fromisoformat(best.date).strftime("%A")
    return (f"Para {mode_label}, a melhor noite é {weekday} ({best.date}) — "
            f"score {best.score}/100. {best.details}")
