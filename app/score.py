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

from app import astro, events, objects
from app.models import (FactorImpact, ForecastResponse, HourDetail,
                        LightPollution, MeteorShower, MilkyWay, NightScore,
                        SkyObject)

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

# Poluição luminosa: Bortle 1 (pristino) não corta nada, Bortle 9 (centro
# urbano) corta até LP_MIN_FACTOR. Aplica-se ao score final e nunca à
# qualidade horária — senão, num sítio Bortle 9 todas as horas cairiam abaixo
# de REPORT_FLOOR e deixaríamos de reportar janelas.
LP_MIN_FACTOR = 0.30

# Seeing a partir do vento a 250 hPa (jet stream). Abaixo de JET_CALM a
# atmosfera está estável; acima de JET_ROUGH a imagem ferve.
JET_CALM = 20.0
JET_ROUGH = 130.0

PROFILES = {
    "deepsky": {
        "label": "céu profundo",
        # Galáxias e nebulosas exigem escuridão real e sofrem muito com a Lua.
        # O seeing conta pouco: o que importa é recolher luz, não resolver detalhe.
        "horizon_degrees": astro.ASTRONOMICAL_TWILIGHT_DEG,
        "moon_weight": 0.70,
        "transparency_floor": 0.70,
        "seeing_floor": 0.88,
    },
    "planetary": {
        "label": "planetas e Lua",
        # Planetas veem-se no crepúsculo e a Lua não atrapalha (é o alvo!).
        # Aqui o seeing é tudo — é ele que decide se vês as bandas de Júpiter.
        "horizon_degrees": astro.SUNSET_DEG,
        "moon_weight": 0.05,
        "transparency_floor": 0.85,
        "seeing_floor": 0.45,
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


def _seeing_factor(jet_kmh, floor: float) -> float:
    """Estabilidade atmosférica a partir do jet stream — contínua, sem degraus."""
    if jet_kmh is None:
        return (1.0 + floor) / 2.0          # meio-termo quando não há dados
    t = (jet_kmh - JET_CALM) / (JET_ROUGH - JET_CALM)
    t = max(0.0, min(1.0, t))
    return 1.0 - (1.0 - floor) * t


def _seeing_label(jet_kmh) -> str:
    if jet_kmh is None:
        return "desconhecido"
    if jet_kmh < 30:
        return "excelente"
    if jet_kmh < 60:
        return "bom"
    if jet_kmh < 100:
        return "médio"
    return "fraco"


def _dew_risk(spread) -> str:
    """Spread baixo = orvalho nas ópticas, e a sessão acaba mais cedo."""
    if spread is None:
        return "desconhecido"
    if spread < 2.0:
        return "alto"
    if spread < 4.0:
        return "moderado"
    return "baixo"


def _feels_like(temp_c, wind_kmh):
    """Sensação térmica (fórmula norte-americana do wind chill)."""
    if temp_c is None:
        return None
    if wind_kmh is None or temp_c > 10.0 or wind_kmh < 4.8:
        return temp_c
    v = wind_kmh ** 0.16
    return 13.12 + 0.6215 * temp_c - 11.37 * v + 0.3965 * temp_c * v


def _moon_phase_name(illum_pct: float) -> str:
    if illum_pct < 5:
        return "Lua nova"
    if illum_pct < 35:
        return "Lua fina"
    if illum_pct < 65:
        return "meia Lua"
    if illum_pct < 95:
        return "Lua gibosa"
    return "Lua cheia"


def _moon_phrase(illum_pct: float, max_alt: float) -> str:
    """"Lua gibosa baixa no céu" — em vez de "Lua 94% a 21°"."""
    if max_alt <= 0:
        return f"{_moon_phase_name(illum_pct)} abaixo do horizonte"
    if max_alt < 15:
        height = "rasante"
    elif max_alt < 40:
        height = "baixa no céu"
    else:
        height = "alta no céu"
    return f"{_moon_phase_name(illum_pct)} {height}"


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


def light_pollution_factor(bortle: int | None) -> float:
    """Bortle 1 → 1.0, Bortle 9 → LP_MIN_FACTOR, linear pelo meio.

    Sem dados (None) devolve 1.0: não inventamos uma penalização que não
    sabemos medir.
    """
    if bortle is None:
        return 1.0
    bortle = max(1, min(9, bortle))
    return 1.0 - (bortle - 1) * (1.0 - LP_MIN_FACTOR) / 8.0


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


def _score_from(qualities: list[float], lp_factor: float) -> int:
    best = _best_window(qualities)
    if best is None:
        return 0
    return int(round(max(0.0, min(100.0, 100.0 * best["value"] * lp_factor))))


def _quality_without(part: dict, skip: str) -> float:
    """Qualidade da hora com um ingrediente neutralizado (posto a 1.0)."""
    return ((1.0 if skip == "nuvens" else part["transmission"])
            * (1.0 if skip == "lua" else part["mf"])
            * (1.0 if skip == "transparencia" else part["tf"])
            * (1.0 if skip == "seeing" else part["sf"]))


def _factor_impacts(parts: list[dict], lp_factor: float,
                    base_score: int) -> list[FactorImpact]:
    """Quantos pontos cada ingrediente custa, medindo o que o score subiria
    se esse ingrediente fosse perfeito. É o que responde a "o que me limita
    esta noite?" — a informação mais acionável que a app pode dar.
    """
    labels = {"nuvens": "as nuvens", "lua": "a Lua",
              "transparencia": "a transparência", "seeing": "o seeing"}
    impacts = []
    for skip, label in labels.items():
        ideal = _score_from([_quality_without(p, skip) for p in parts], lp_factor)
        cost = ideal - base_score
        if cost > 0:
            impacts.append(FactorImpact(factor=skip, label=label, cost_points=cost))

    # A poluição luminosa é constante na noite, mas conta como limitação.
    if lp_factor < 1.0:
        cost = _score_from([p["quality"] for p in parts], 1.0) - base_score
        if cost > 0:
            impacts.append(FactorImpact(factor="poluicao",
                                        label="a poluição luminosa",
                                        cost_points=cost))

    impacts.sort(key=lambda f: -f.cost_points)
    return impacts


def _hour_reason(part: dict) -> str:
    """Uma razão legível para o valor desta hora — não um número a mais."""
    if part["transmission"] < 0.30:
        return "encoberto"
    if part["transmission"] < 0.70:
        return "nuvens"
    if part["mf"] < 0.75:
        return "Lua alta"
    if part["tf"] < 0.85:
        return "ar húmido"
    if part["mf"] < 0.92:
        return "Lua baixa"
    return "bom"


def _hour_detail(part: dict, times, h, moon_alt, moon_illum,
                 in_window: bool) -> HourDetail:
    i = part["i"]

    def val(name):
        series = h.get(name)
        return None if series is None else series[i]

    return HourDetail(
        time=times[i].isoformat(timespec="minutes"),
        quality=round(part["quality"], 3),
        in_window=in_window,
        reason=_hour_reason(part),
        cloud_transmission=round(part["transmission"], 3),
        moon_factor=round(part["mf"], 3),
        transparency_factor=round(part["tf"], 3),
        cloud_total_pct=val("cloud_cover"),
        cloud_low_pct=val("cloud_cover_low"),
        cloud_mid_pct=val("cloud_cover_mid"),
        cloud_high_pct=val("cloud_cover_high"),
        temperature_c=val("temperature_2m"),
        dew_point_c=val("dew_point_2m"),
        dew_spread_c=None if part["spread"] is None else round(part["spread"], 1),
        humidity_pct=val("relative_humidity_2m"),
        visibility_m=val("visibility"),
        wind_speed_kmh=val("wind_speed_10m"),
        wind_gusts_kmh=val("wind_gusts_10m"),
        jet_stream_kmh=val("wind_speed_250hPa"),
        precipitation_prob_pct=val("precipitation_probability"),
        moon_altitude_deg=round(float(moon_alt[i]), 1),
        moon_illumination_pct=round(float(moon_illum[i]) * 100, 1),
    )


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
                   mode: str = DEFAULT_MODE,
                   light_pollution: dict | None = None) -> ForecastResponse:
    profile = PROFILES.get(mode, PROFILES[DEFAULT_MODE])
    times, h = _parse_hourly(data)
    offset = int(data.get("utc_offset_seconds", 0))
    tzname = data.get("timezone", "UTC")

    dates = sorted({t.date() for t in times})
    windows = astro.compute_windows(lat, lon, offset, dates,
                                    profile["horizon_degrees"])
    moon_alt, moon_illum = astro.moon_series(lat, lon, offset, times)

    bortle = light_pollution.get("bortle") if light_pollution else None
    lp_factor = light_pollution_factor(bortle)

    nights = [
        _build_night(d, windows.get(d, (None, None)), times, h,
                     moon_alt, moon_illum, profile, lat, lon, offset, lp_factor)
        for d in dates
    ]

    return ForecastResponse(
        latitude=lat, longitude=lon, timezone=tzname,
        mode=mode, mode_label=profile["label"],
        light_pollution=LightPollution(**light_pollution) if light_pollution else None,
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        summary=_build_summary(nights, profile["label"]),
        nights=nights,
    )


def _build_night(d, window, times, h, moon_alt, moon_illum, profile,
                 lat: float, lon: float, offset: int,
                 lp_factor: float = 1.0) -> NightScore:
    night_start, night_end = window

    if night_start is None or night_end is None:
        return NightScore(
            date=d.isoformat(), score=0, verdict="Sem noite escura",
            moon_phase="—", moonrise=None, moonset=None,
            seeing="desconhecido", dew_risk="desconhecido",
            temperature_c=None, feels_like_c=None, wind_kmh=None,
            meteor_shower=None, milky_way=None,
            limiting=[], objects=[], hours=[],
            window_start=None, window_end=None, window_hours=None,
            night_start=None, night_end=None, night_hours=None,
            cloud_cover_pct=None, transparency="—",
            moon_illumination_pct=0.0, moon_max_altitude_deg=None,
            conditions="O Sol não desce o suficiente para haver escuridão.",
            details="O Sol não desce o suficiente nesta noite — sem escuridão utilizável.",
        )

    idx = [i for i, t in enumerate(times) if night_start <= t <= night_end]
    if not idx:
        return NightScore(
            date=d.isoformat(), score=0, verdict="Sem dados",
            moon_phase="—", moonrise=None, moonset=None,
            seeing="desconhecido", dew_risk="desconhecido",
            temperature_c=None, feels_like_c=None, wind_kmh=None,
            meteor_shower=None, milky_way=None,
            limiting=[], objects=[], hours=[],
            window_start=None, window_end=None, window_hours=None,
            night_start=night_start.isoformat(timespec="minutes"),
            night_end=night_end.isoformat(timespec="minutes"),
            night_hours=round((night_end - night_start).total_seconds() / 3600, 1),
            cloud_cover_pct=None, transparency="—",
            moon_illumination_pct=0.0, moon_max_altitude_deg=None,
            conditions="Sem previsão meteorológica para esta noite.",
            details="Sem previsão meteorológica para esta noite.",
        )

    floor = profile["transparency_floor"]
    weight = profile["moon_weight"]

    seeing_floor = profile["seeing_floor"]
    jet_series = h.get("wind_speed_250hPa")

    parts = []
    for i in idx:
        transmission = _cloud_transmission(
            h["cloud_cover_low"][i], h["cloud_cover_mid"][i],
            h["cloud_cover_high"][i], h["cloud_cover"][i])
        spread = _spread(h["temperature_2m"][i], h["dew_point_2m"][i])
        jet = jet_series[i] if jet_series else None
        tf = _transparency_factor(spread, floor)
        mf = _moon_factor(float(moon_illum[i]), float(moon_alt[i]), weight)
        sf = _seeing_factor(jet, seeing_floor)
        parts.append({"i": i, "transmission": transmission, "tf": tf, "mf": mf,
                      "sf": sf, "spread": spread, "jet": jet,
                      "quality": transmission * tf * mf * sf})

    qualities = [p["quality"] for p in parts]
    spreads = [p["spread"] for p in parts]

    best = _best_window(qualities)
    score = int(round(max(0.0, min(100.0, 100.0 * best["value"] * lp_factor))))

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

    # Condições em linguagem corrente. O "porquê", não os números crus —
    # esses vivem na tabela de dados para quem os quiser.
    jet_avg = _mean([p["jet"] for p in parts])
    temp = _mean([h["temperature_2m"][i] for i in win_idx])
    wind = _mean([h.get("wind_speed_10m", [None] * len(times))[i] for i in win_idx])
    spread_win = _mean([p["spread"] for p in parts[ext_i:ext_j + 1]])
    moon_phrase = _moon_phrase(illum_pct, max_alt)

    phrases = []
    if cloud is not None:
        phrases.append("céu limpo" if cloud < 15
                       else "poucas nuvens" if cloud < 40 else "muitas nuvens")
    phrases.append(moon_phrase)
    if spread_win is not None:
        phrases.append("ar seco" if spread_win >= 6
                       else "ar húmido" if spread_win < 3 else "humidade moderada")
    seeing_label = _seeing_label(jet_avg)
    if seeing_label != "desconhecido":
        phrases.append(f"seeing {seeing_label}")

    # A janela e as condições vivem separadas: a interface já mostra as horas,
    # e repeti-las na frase era a origem do "5.4h" duplicado no card.
    # `.capitalize()` não serve: põe em minúscula tudo o resto e come o L de "Lua".
    frase = ", ".join(phrases)
    conditions = frase[0].upper() + frase[1:] + "."
    details = (f"{win_hours:.1f}h das {win_start.strftime('%H:%M')} às "
               f"{win_end.strftime('%H:%M')} · " + ", ".join(phrases) + ".")

    window_positions = set(range(ext_i, ext_j + 1))
    hours = [_hour_detail(p, times, h, moon_alt, moon_illum, pos in window_positions)
             for pos, p in enumerate(parts)]

    # O que se vê a meio da janela recomendada.
    mid = win_idx[len(win_idx) // 2]
    sky = objects.visible_objects(lat, lon, offset, times[mid],
                                  float(moon_illum[mid]), float(moon_alt[mid]),
                                  window_start=win_start, window_end=win_end)
    moonrise, moonset = astro.moon_rise_set(lat, lon, offset, d)

    moonlight = float(moon_illum[mid]) * max(0.0, float(moon_alt[mid]) / 90.0)
    shower = events.meteor_shower(d, lat, lon, offset, times[mid],
                                  win_start, win_end)
    galaxy = events.milky_way_core(lat, lon, offset, times[mid],
                                   win_start, win_end, moonlight)

    return NightScore(
        date=d.isoformat(), score=score, verdict=_verdict(score),
        moon_phase=moon_phrase,
        moonrise=moonrise.isoformat(timespec="minutes") if moonrise else None,
        moonset=moonset.isoformat(timespec="minutes") if moonset else None,
        seeing=seeing_label,
        dew_risk=_dew_risk(spread_win),
        temperature_c=None if temp is None else round(temp, 1),
        feels_like_c=(None if temp is None
                      else round(_feels_like(temp, wind), 1)),
        wind_kmh=None if wind is None else round(wind, 1),
        meteor_shower=MeteorShower(**shower) if shower else None,
        milky_way=MilkyWay(**galaxy) if galaxy else None,
        limiting=_factor_impacts(parts, lp_factor, score),
        objects=[SkyObject(**o) for o in sky],
        hours=hours,
        window_start=win_start.isoformat(timespec="minutes"),
        window_end=win_end.isoformat(timespec="minutes"),
        window_hours=round(win_hours, 1),
        night_start=night_start.isoformat(timespec="minutes"),
        night_end=night_end.isoformat(timespec="minutes"),
        night_hours=round((night_end - night_start).total_seconds() / 3600, 1),
        conditions=conditions,
        cloud_cover_pct=None if cloud is None else round(cloud, 1),
        transparency=label,
        moon_illumination_pct=round(illum_pct, 1),
        moon_max_altitude_deg=round(max_alt, 1),
        details=details,
    )


WEEKDAYS_PT = ["segunda", "terça", "quarta", "quinta",
               "sexta", "sábado", "domingo"]


def _build_summary(nights: list[NightScore], mode_label: str) -> str:
    """As horas e o porquê. A poluição luminosa fica de fora de propósito:
    é propriedade do local, não da noite, e tem caixa própria na interface.
    """
    scored = [n for n in nights if n.score > 0]
    if not scored:
        return f"Nenhuma noite com condições utilizáveis para {mode_label} nos próximos dias."

    best = max(scored, key=lambda n: n.score)
    d = datetime.fromisoformat(best.date)
    weekday = WEEKDAYS_PT[d.weekday()]
    return (f"Melhor noite: {weekday}, {d.strftime('%d/%m')} — {best.details}")
