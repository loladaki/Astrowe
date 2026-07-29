"""Modelos Pydantic para a resposta da API."""
from __future__ import annotations

from pydantic import BaseModel


class LightPollution(BaseModel):
    """Propriedade do local, constante no tempo — não da noite."""
    bortle: int                          # 1 (pristino) a 9 (centro urbano)
    sqm: float                           # mag/arcsec²
    artificial_mcd_m2: float             # brilho artificial bruto
    description: str                     # "céu rural, pouca luz"
    cut_pct: int = 0                     # % do potencial que este céu corta
    source: str


class SkyObject(BaseModel):
    """Algo que se pode observar à hora recomendada."""
    name: str                            # "M31", "Saturno"
    kind: str                            # "galáxia", "planeta", …
    magnitude: float | None
    altitude_deg: float
    azimuth_deg: float
    direction: str                       # "SE", "ONO", …
    washed_out: bool                     # apagado pelo luar
    ra_h: float                          # ascensão recta (horas)
    dec_deg: float                       # declinação (graus)
    url: str                             # ficha no Telescopius

    airmass: float | None                # atmosfera atravessada (1.0 no zénite)
    trend: str                           # "a subir" / "a descer" / "no ponto alto"
    max_altitude_deg: float              # altura no meridiano, nesta latitude
    transit_time: str | None             # culminação, se cair dentro da janela
    symbol: str                          # símbolo de atlas: "galaxy", "globular"…
    altitudes: list[float] = []          # altura em cada hora da janela


class NightCards(BaseModel):
    """Cada condição com a estatística que interessa, não a média."""
    clouds_label: str                    # "Limpa às 02:00"
    clouds_spark: list[float | None]
    dew_label: str                       # "Provável às 04:00"
    dew_spark: list[float | None]
    temp_label: str                      # "21° → 17°"
    moon_label: str                      # "Põe-se 01:41"


class MeteorShower(BaseModel):
    name: str
    peak_offset_days: int                # 0 = noite do pico
    zhr: int                             # meteoros/hora no melhor caso
    radiant_altitude_deg: float
    radiant_direction: str
    summary: str
    trend: str
    max_altitude_deg: float
    transit_time: str | None


class ISSPass(BaseModel):
    """Uma passagem visível da ISS na noite."""
    start: str                           # hora local ISO (nasce)
    peak: str                            # culminação
    end: str                             # põe-se
    peak_altitude_deg: float
    peak_direction: str
    rise_direction: str
    set_direction: str
    duration_min: int


class ISSOutlook(BaseModel):
    """Resposta à pergunta 'vou ver a ISS?', ao nível de toda a previsão.

    A ISS só é visível em *temporadas* (quando a órbita apanha o Sol ao
    crepúsculo); há semanas sem qualquer passagem. Esta secção diz sempre algo:
    ou é visível esta semana, ou quando volta a sê-lo (data aproximada — o TLE
    perde precisão a semanas de distância), ou que não há nada no horizonte.
    """
    visible_this_week: bool              # há passagens nalguma noite da janela
    next_pass: ISSPass | None = None     # a próxima passagem visível (pode ser além da janela)
    horizon_days: int                    # até quantos dias à frente se procurou


class MilkyWay(BaseModel):
    """Núcleo galáctico — o alvo do verão para astrofotografia."""
    altitude_deg: float
    direction: str
    max_altitude_deg: float
    summary: str
    trend: str
    transit_time: str | None


class HourDetail(BaseModel):
    """Uma hora da noite: o veredicto e os dados crus por trás dele."""
    time: str                        # hora local ISO
    quality: float                   # 0–1, o que alimenta o score
    in_window: bool                  # dentro da janela recomendada
    reason: str                      # "bom", "nuvens", "Lua alta", …

    # Decomposição do score — porque é que esta hora vale o que vale
    cloud_transmission: float        # 0–1, céu que passa depois das camadas
    moon_factor: float               # 0–1
    transparency_factor: float       # 0–1

    # Meteorologia crua, para quem prefere interpretar sozinho
    cloud_total_pct: float | None
    cloud_low_pct: float | None
    cloud_mid_pct: float | None
    cloud_high_pct: float | None
    temperature_c: float | None
    dew_point_c: float | None
    dew_spread_c: float | None
    humidity_pct: float | None
    visibility_m: float | None
    wind_speed_kmh: float | None
    wind_gusts_kmh: float | None
    jet_stream_kmh: float | None     # vento a 250 hPa — indicador de seeing
    precipitation_prob_pct: float | None

    # Astronomia
    moon_altitude_deg: float
    moon_illumination_pct: float


class FactorImpact(BaseModel):
    """Quantos pontos um ingrediente está a custar nesta noite."""
    factor: str                      # "nuvens" | "lua" | "transparencia" | "poluicao"
    label: str
    cost_points: int


class NightScore(BaseModel):
    date: str                            # dia local em que a noite começa
    in_progress: bool = False            # noite a decorrer agora (só as horas que faltam)
    score: int                           # 0–100
    verdict: str                         # "Excelente" / "Boa" / "Razoável" / "Fraca"
    headline: str                        # "Sim — melhor depois das 02:00"
    verdict_reason: str                  # "Lua põe-se 01:41, seeing melhora"
    cards: NightCards | None

    # A melhor janela contígua de observação — o coração da resposta.
    window_start: str | None             # hora local ISO
    window_end: str | None
    window_hours: float | None

    # A noite disponível (escuridão astronómica, ou pôr→nascer do Sol).
    night_start: str | None
    night_end: str | None
    night_hours: float | None

    # Para a banda de luz: pôr/nascer do Sol e crepúsculo astronómico (−18°).
    sun_set: str | None = None
    sun_rise: str | None = None
    dusk: str | None = None       # fim do crepúsculo astronómico (céu escuro)
    dawn: str | None = None       # início do amanhecer astronómico

    cloud_cover_pct: float | None        # nuvens médias durante a janela
    transparency: str                    # "boa" / "razoável" / "fraca"
    moon_illumination_pct: float         # fração iluminada da Lua (0–100)
    moon_waxing: bool                    # crescente (lado iluminado à direita)
    moon_max_altitude_deg: float | None  # altura máxima da Lua durante a noite

    conditions: str                      # só as condições: "céu limpo, ar seco…"
    details: str                         # frase completa (resumo, comparação)

    # Condições na janela recomendada, em linguagem corrente
    moon_phase: str                      # "Lua gibosa baixa no céu"
    moonrise: str | None                 # hora local ISO
    moonset: str | None
    seeing: str                          # "excelente" / "bom" / "médio" / "fraco"
    dew_risk: str                        # "baixo" / "moderado" / "alto"
    temperature_c: float | None          # média na janela
    feels_like_c: float | None           # sensação térmica (vento)
    wind_kmh: float | None

    meteor_shower: MeteorShower | None   # se a noite cair perto de um pico
    milky_way: MilkyWay | None
    iss_passes: list[ISSPass] = []       # passagens visíveis da ISS

    limiting: list[FactorImpact]         # o que custa pontos, do pior ao menor
    objects: list[SkyObject]             # o que se vê a meio da janela
    hours: list[HourDetail]              # detalhe hora a hora da noite


class ForecastResponse(BaseModel):
    latitude: float
    longitude: float
    timezone: str
    mode: str                            # "deepsky" | "planetary"
    mode_label: str
    light_pollution: LightPollution | None   # None se não houver chave da API
    generated_at: str                    # ISO UTC
    summary: str                         # o julgamento de topo
    iss: ISSOutlook | None = None        # vou ver a ISS? (ver ISSOutlook)
    nights: list[NightScore]
