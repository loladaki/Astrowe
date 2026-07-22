"""Eventos que mudam o "vale a pena sair": chuveiros de meteoros e a Via Láctea.

Ao contrário das condições meteorológicas, estes dependem da época do ano e
do relógio sideral — calculam-se offline, sem API nenhuma.
"""
from __future__ import annotations

from datetime import date, datetime

from skyfield.api import Star, wgs84

from app.astro import _ensure_loaded, _local_to_utc
from app.objects import (_timing, compass_point, local_sidereal_hours,
                         transit_altitude)

# Núcleo galáctico (Sagitário A*), J2000. É o alvo do verão para astrofotografia.
MILKY_WAY_RA_H = 17.7611
MILKY_WAY_DEC_DEG = -29.0078

# Chuveiros principais: nome, mês e dia do pico, ZHR (meteoros/hora no melhor
# caso) e radiante em J2000. Valores da International Meteor Organization.
METEOR_SHOWERS = [
    ("Quadrântidas", 1, 3, 110, 15.33, 49.7),
    ("Líridas", 4, 22, 18, 18.07, 33.3),
    ("Eta Aquáridas", 5, 6, 50, 22.53, -1.0),
    ("Delta Aquáridas", 7, 30, 25, 22.70, -16.4),
    ("Perseidas", 8, 12, 100, 3.22, 58.0),
    ("Oriónidas", 10, 21, 20, 6.35, 15.6),
    ("Táuridas do Sul", 11, 5, 5, 3.50, 14.0),
    ("Leónidas", 11, 17, 15, 10.28, 21.6),
    ("Gemínidas", 12, 14, 150, 7.55, 32.3),
    ("Úrsidas", 12, 22, 10, 14.47, 75.3),
]

# Uma noite conta como "de chuveiro" se estiver a esta distância do pico.
DAYS_AROUND_PEAK = 2


def _radiant_position(lat: float, lon: float, offset_seconds: int,
                      when_local: datetime, ra_h: float, dec_deg: float):
    """Altura, azimute e coordenadas *da data* de um ponto fixo do céu.

    As coordenadas da tabela são J2000; o trânsito compara-se com o tempo
    sideral, que é da data. Sem converter, a precessão introduz ~0.37° de erro.
    """
    ts, eph = _ensure_loaded()
    observer = eph["earth"] + wgs84.latlon(lat, lon)
    t = ts.from_datetime(_local_to_utc(when_local, offset_seconds))
    apparent = observer.at(t).observe(
        Star(ra_hours=ra_h, dec_degrees=dec_deg)).apparent()
    alt, az, _ = apparent.altaz()
    ra_d, dec_d, _ = apparent.radec(epoch="date")
    return t, alt.degrees, az.degrees, ra_d.hours, dec_d.degrees


def _days_from_peak(night: date, month: int, day: int) -> int:
    """Distância ao pico, tratando a viragem de ano (Quadrântidas, Úrsidas)."""
    return min(abs((night - date(year, month, day)).days)
               for year in (night.year - 1, night.year, night.year + 1))


def meteor_shower(night: date, lat: float, lon: float, offset_seconds: int,
                  when_local: datetime,
                  window_start: datetime | None,
                  window_end: datetime | None) -> dict | None:
    """O chuveiro activo nesta noite, se houver, com o radiante posicionado.

    Um radiante baixo corta muito a quantidade de meteoros visíveis, por isso
    a altura conta tanto como o ZHR.
    """
    ativo = None
    for nome, mes, dia, zhr, ra, dec in METEOR_SHOWERS:
        dias = _days_from_peak(night, mes, dia)
        if dias <= DAYS_AROUND_PEAK and (ativo is None or dias < ativo[0]):
            ativo = (dias, nome, zhr, ra, dec)

    if ativo is None:
        return None

    dias, nome, zhr, ra, dec = ativo
    t, alt, az, ra_d, dec_d = _radiant_position(lat, lon, offset_seconds,
                                                when_local, ra, dec)
    lst = local_sidereal_hours(t, lon)
    tempos = _timing(lst, ra_d, dec_d, lat, when_local, window_start, window_end)

    if alt <= 0:
        nota = "radiante abaixo do horizonte — poucos meteoros"
    elif alt < 25:
        nota = "radiante baixo, muitos meteoros ficam escondidos"
    else:
        nota = "radiante bem alto"

    quando = "no pico" if dias == 0 else f"a {dias} dia{'s' if dias > 1 else ''} do pico"
    return {
        "name": nome,
        "peak_offset_days": dias,
        "zhr": zhr,
        "radiant_altitude_deg": round(alt, 1),
        "radiant_direction": compass_point(az),
        "summary": f"{nome} — {quando}, até {zhr} meteoros/hora. {nota}.",
        **tempos,
    }


def milky_way_core(lat: float, lon: float, offset_seconds: int,
                   when_local: datetime,
                   window_start: datetime | None,
                   window_end: datetime | None,
                   moonlight: float = 0.0) -> dict | None:
    """O núcleo da Via Láctea nesta noite — visível, e a que horas fica melhor.

    Devolve None onde nunca sobe acima do horizonte.
    """
    if transit_altitude(lat, MILKY_WAY_DEC_DEG) <= 0:
        return None

    t, alt, az, ra_d, dec_d = _radiant_position(lat, lon, offset_seconds,
                                                when_local, MILKY_WAY_RA_H,
                                                MILKY_WAY_DEC_DEG)
    maxima = transit_altitude(lat, dec_d)
    lst = local_sidereal_hours(t, lon)
    tempos = _timing(lst, ra_d, dec_d, lat, when_local, window_start, window_end)

    if alt <= 0:
        nota = "abaixo do horizonte nesta altura da noite"
    elif moonlight > 0.35:
        nota = "no céu, mas o luar apaga-lhe o contraste"
    elif alt < 15:
        nota = "muito rasante — precisas de horizonte sul desimpedido"
    else:
        nota = "bem posicionado a sul"

    return {
        "altitude_deg": round(alt, 1),
        "direction": compass_point(az),
        "max_altitude_deg": round(maxima, 1),
        "summary": f"Núcleo da Via Láctea a {round(alt)}° — {nota}.",
        **tempos,
    }
