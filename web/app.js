"use strict";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";

const form = $("search-form");
const placeInput = $("place");
const suggestionsEl = $("suggestions");
const geoBtn = $("geo-btn");
const mapBtn = $("map-btn");
const statusEl = $("status");
const resultEl = $("result");
const placeNameEl = $("place-name");
const placeSkyEl = $("place-sky");
const stripEl = $("strip");
const detailEl = $("detail");
const modeBtns = document.querySelectorAll(".mode-btn");

const savedListEl = $("saved-list");
const saveBtn = $("save-btn");
const compareBtn = $("compare-btn");
const saveForm = $("save-form");
const saveName = $("save-name");
const saveConfirm = $("save-confirm");
const saveCancel = $("save-cancel");

const mapModal = $("map-modal");
const mapClose = $("map-close");
const mapConfirm = $("map-confirm");
const mapCoords = $("map-coords");
const mapLp = $("map-lp");
const darkerBtn = $("darker-btn");
const darkerStatus = $("darker-status");
const darkerList = $("darker-list");
const darkerCta = $("darker-cta");
const compareModal = $("compare-modal");
const compareClose = $("compare-close");
const compareBody = $("compare-body");

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const SAVED_KEY = "astrowe.places";
const COUNTRY_KEY = "astrowe.country";
const TOP_OBJECTS = 6;

// Tem de bater certo com HOURLY_VARS em app/openmeteo.py. O browser vai buscar
// a meteorologia directamente (usa a quota do IP do utilizador, não a do IP
// partilhado do Render, que o Open-Meteo esgota por dia).
const HOURLY_VARS = [
  "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
  "relative_humidity_2m", "dew_point_2m", "temperature_2m", "visibility",
  "wind_speed_10m", "wind_gusts_10m", "wind_speed_250hPa", "precipitation_probability",
];

/** Previsão para um local: mete a meteorologia (obtida aqui no browser) no
 *  backend, que faz o resto. Se a busca no browser falhar, recua para o
 *  servidor a ir buscá-la (GET). */
async function computeForecast(lat, lon, m) {
  try {
    const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}` +
                `&hourly=${HOURLY_VARS.join(",")}&timezone=auto&forecast_days=7`;
    const wr = await fetch(url);
    if (wr.ok) {
      const weather = await wr.json();
      const res = await fetch("/api/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon, mode: m, weather }),
      });
      if (res.ok) return res.json();
    }
  } catch { /* cai para o recuo no servidor */ }

  const res = await fetch(`/api/forecast?lat=${lat}&lon=${lon}&mode=${m}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Erro ${res.status}`);
  }
  return res.json();
}

let current = null;
let mode = "deepsky";
let lastData = null;
let selectedDate = null;
let skyPlayTimer = null;   // animação do slider da cúpula (só uma de cada vez)

const hhmm = (iso) => iso.slice(11, 16);
const hh = (iso) => iso.slice(11, 13) + "h";
const num = (v, d = 0) => (v === null || v === undefined ? "—" : v.toFixed(d));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function svg(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function setStatus(msg) {
  statusEl.hidden = !msg;
  statusEl.textContent = msg || "";
}

/* ------------------------------------------------- desenhos */

/**
 * A Lua desenhada com o terminador real, não um de oito ícones genéricos.
 * Sabemos a fração iluminada exacta — a 78% desenha-se a 78%.
 *
 * Dois arcos: o limbo (semicírculo do lado iluminado) e o terminador, que é
 * uma semi-elipse de raio horizontal R·|1−2k|. Achatada na meia-Lua, a
 * inchar para os quartos.
 */
let moonSeq = 0;
// Crateras (x, y, raio) no disco de 30 — só aparecem nas Luas grandes.
const CRATERS = [[11, 10, 2.3], [19, 13, 1.6], [15, 19, 2.8], [9, 17, 1.3],
                 [21, 20, 1.1], [13, 24, 1.5]];

function moonSVG(illumPct, waxing, size = 26) {
  const k = Math.max(0, Math.min(1, illumPct / 100));
  const R = 13, cx = 15, cy = 15;
  const rx = (R * Math.abs(1 - 2 * k)).toFixed(2);
  // O limbo brilhante fica à direita quando crescente (hemisfério norte). O
  // flag do terminador tem de inverter na passagem pela meia-Lua, senão uma
  // Lua a 94% desenha-se como um sliver de 6%. (Área verificada com isPointInFill.)
  const outer = waxing ? 1 : 0;
  const inner = (k > 0.5) ? (waxing ? 1 : 0) : (waxing ? 0 : 1);
  const litPath = `M ${cx} ${cy - R} A ${R} ${R} 0 0 ${outer} ${cx} ${cy + R}` +
                  ` A ${rx} ${R} 0 0 ${inner} ${cx} ${cy - R} Z`;
  const rich = size >= 40;   // esfera sombreada + crateras só nas grandes

  const g = svg("svg", { width: size, height: size, viewBox: "0 0 30 30", "aria-hidden": "true" });

  if (rich && k > 0.01) {
    // Parte iluminada sólida (cor de pergaminho) + crateras recortadas a ela,
    // para dar textura sem depender de gradientes (que resolvem mal em SVG).
    const id = "moon" + (moonSeq++);
    const defs = svg("defs", {});
    const clip = svg("clipPath", { id: id + "c" });
    clip.append(svg("path", { d: litPath }));
    defs.append(clip);
    g.append(defs);
    g.append(svg("circle", { cx, cy, r: R, fill: "#14120f",
                             stroke: "var(--border-lit)", "stroke-width": 0.6 }));
    g.append(svg("path", { d: litPath, fill: "var(--moon)" }));
    const craters = svg("g", { "clip-path": `url(#${id}c)` });
    for (const [x, y, r] of CRATERS) {
      craters.append(svg("circle", { cx: x, cy: y, r, fill: "rgba(70,55,32,0.18)" }));
    }
    // leve escurecimento junto ao terminador, para dar volume
    g.append(svg("path", { d: litPath, fill: "none",
                           stroke: "rgba(60,48,28,0.22)", "stroke-width": 1.2 }));
    g.append(craters);
  } else {
    // versão simples (tira, cartões): disco escuro + parte iluminada clara
    g.append(svg("circle", { cx, cy, r: R, fill: "var(--border-lit)",
                             stroke: "var(--dim)", "stroke-width": 0.75 }));
    if (k > 0.01) g.append(svg("path", { d: litPath, fill: "var(--text)" }));
  }
  return g;
}

/** Símbolos convencionais dos atlas celestes — lêem-se sem legenda. */
function symbolSVG(kind, size = 14, color = "var(--dim)") {
  const g = svg("svg", { width: size, height: size, viewBox: "0 0 30 30",
                         class: "obj-sym", "aria-hidden": "true" });
  const st = { fill: "none", stroke: color, "stroke-width": 2.5 };
  const line = (x1, y1, x2, y2) => svg("line", { x1, y1, x2, y2, stroke: color, "stroke-width": 2.5 });

  if (kind === "galaxy") {
    g.append(svg("ellipse", { cx: 15, cy: 15, rx: 12, ry: 6, transform: "rotate(-25 15 15)", ...st }));
  } else if (kind === "open_cluster") {
    g.append(svg("circle", { cx: 15, cy: 15, r: 10, "stroke-dasharray": "3 3", ...st }),
             svg("circle", { cx: 12, cy: 13, r: 1.4, fill: color }),
             svg("circle", { cx: 18, cy: 16, r: 1.4, fill: color }),
             svg("circle", { cx: 15, cy: 19, r: 1.4, fill: color }));
  } else if (kind === "globular") {
    g.append(svg("circle", { cx: 15, cy: 15, r: 10, ...st }), line(15, 5, 15, 25), line(5, 15, 25, 15));
  } else if (kind === "planetary") {
    g.append(svg("circle", { cx: 15, cy: 15, r: 6, ...st }),
             line(15, 3, 15, 9), line(15, 21, 15, 27), line(3, 15, 9, 15), line(21, 15, 27, 15));
  } else if (kind === "double") {
    g.append(line(9, 15, 21, 15),
             svg("circle", { cx: 9, cy: 15, r: 3, fill: color }),
             svg("circle", { cx: 21, cy: 15, r: 2.2, fill: color }));
  } else if (kind === "planet") {
    g.append(svg("circle", { cx: 15, cy: 15, r: 7, fill: color }),
             svg("ellipse", { cx: 15, cy: 15, rx: 13, ry: 3.5, transform: "rotate(-20 15 15)",
                              fill: "none", stroke: color, "stroke-width": 2 }));
  } else if (kind === "moon") {
    return moonSVG(50, true, size);
  } else {
    g.append(svg("rect", { x: 5, y: 8, width: 20, height: 14, rx: 2, "stroke-dasharray": "4 3", ...st }));
  }
  return g;
}

/* ---- Astronomia no cliente: posições ao vivo para a cúpula e o slider.
   Recalcula altura/azimute de objectos e estrelas a qualquer hora da noite,
   a partir de RA/Dec (as mesmas coordenadas que o backend envia) e da
   localização. É isto que transforma a cúpula de um instantâneo num céu que
   roda quando se arrasta o slider. */

// Offset (segundos) de um fuso IANA num instante — trata do horário de verão.
function tzOffsetSeconds(tz, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 1000;
}

// Hora local "naïve" (ISO sem fuso, como vem do Open-Meteo) -> instante UTC.
function localWallToUTC(wallIso, tz) {
  const approx = new Date(wallIso + "Z");      // lê a parede como se fosse UTC
  const off = tzOffsetSeconds(tz, approx);     // offset ~nesse instante
  return new Date(approx.getTime() - off * 1000);
}

// Tempo sideral local, em graus (longitude a Este positiva).
function localSiderealDeg(utcDate, lonDeg) {
  const JD = utcDate.getTime() / 86400000 + 2440587.5;
  const D = JD - 2451545.0;
  const gmst = 280.46061837 + 360.98564736629 * D;
  return (((gmst + lonDeg) % 360) + 360) % 360;
}

// (RA horas, Dec graus) + TSL + latitude -> [altura, azimute] (N=0, E=90).
function altAz(raH, decDeg, lstDeg, latDeg) {
  const d2r = Math.PI / 180;
  const H = (lstDeg - raH * 15) * d2r;
  const dec = decDeg * d2r, lat = latDeg * d2r;
  const sinAlt = Math.sin(lat) * Math.sin(dec)
               + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / d2r;
  let az = Math.atan2(Math.sin(H),
                      Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) / d2r;
  az = ((az + 180) % 360 + 360) % 360;         // de "a partir do Sul" para N=0, E=90
  return [alt, az];
}

const SKY_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                     "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
const skyCompass = (az) => SKY_COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
// Kasten-Young, como no backend: 1.0 no zénite, 2.0 a ~30°.
const skyAirmass = (alt) =>
  alt <= 0 ? null : 1 / (Math.sin(alt * Math.PI / 180)
                         + 0.50572 * Math.pow(alt + 6.07995, -1.6364));

// As ~90 estrelas mais brilhantes (mag ≲ 3), coordenadas J2000 [RA h, Dec °,
// magnitude, nome]. Chega para se reconhecerem as constelações principais na
// cúpula; as ténues ficam de fora de propósito, para não virar sopa de pontos.
const BRIGHT_STARS = [
  [6.7525, -16.716, -1.46, "Sirius"], [6.3992, -52.696, -0.74, "Canopus"],
  [14.6600, -60.833, -0.27, "Rigil Kent."], [14.2610, 19.182, -0.05, "Arcturus"],
  [18.6156, 38.784, 0.03, "Vega"], [5.2782, 45.998, 0.08, "Capella"],
  [5.2423, -8.202, 0.13, "Rigel"], [7.6550, 5.225, 0.34, "Procyon"],
  [1.6286, -57.237, 0.46, "Achernar"], [5.9195, 7.407, 0.50, "Betelgeuse"],
  [14.0637, -60.373, 0.61, "Hadar"], [19.8464, 8.868, 0.77, "Altair"],
  [12.4433, -63.099, 0.77, "Acrux"], [4.5987, 16.509, 0.85, "Aldebaran"],
  [13.4199, -11.161, 1.04, "Spica"], [16.4901, -26.432, 1.09, "Antares"],
  [7.7553, 28.026, 1.14, "Pollux"], [22.9608, -29.622, 1.16, "Fomalhaut"],
  [20.6905, 45.280, 1.25, "Deneb"], [12.7953, -59.689, 1.25, "Mimosa"],
  [10.1395, 11.967, 1.35, "Regulus"], [6.9770, -28.972, 1.50, "Adhara"],
  [7.5767, 31.888, 1.58, "Castor"], [17.5601, -37.104, 1.62, "Shaula"],
  [12.5194, -57.113, 1.63, "Gacrux"], [5.4189, 6.350, 1.64, "Bellatrix"],
  [5.4382, 28.608, 1.65, "Elnath"], [9.2200, -69.717, 1.68, "Miaplacidus"],
  [5.6036, -1.202, 1.69, "Alnilam"], [5.6793, -1.943, 1.74, "Alnitak"],
  [22.1372, -46.961, 1.74, "Alnair"], [12.9004, 55.960, 1.77, "Alioth"],
  [11.0621, 61.751, 1.79, "Dubhe"], [3.4054, 49.861, 1.79, "Mirfak"],
  [7.1399, -26.393, 1.83, "Wezen"], [18.4029, -34.385, 1.85, "Kaus Aus."],
  [8.3752, -59.510, 1.86, "Avior"], [13.7923, 49.313, 1.86, "Alkaid"],
  [17.6220, -42.998, 1.87, "Sargas"], [5.9922, 44.947, 1.90, "Menkalinan"],
  [16.8110, -69.028, 1.91, "Atria"], [6.6285, 16.399, 1.93, "Alhena"],
  [20.4275, -56.735, 1.94, "Peacock"], [6.3783, -17.956, 1.98, "Mirzam"],
  [9.4597, -8.659, 1.98, "Alphard"], [2.5303, 89.264, 1.98, "Polaris"],
  [2.1195, 23.462, 2.00, "Hamal"], [10.3328, 19.842, 2.01, "Algieba"],
  [0.7265, -17.987, 2.04, "Diphda"], [5.7958, -9.670, 2.06, "Saiph"],
  [18.9211, -26.297, 2.05, "Nunki"], [0.1398, 29.091, 2.06, "Alpheratz"],
  [1.1622, 35.621, 2.07, "Mirach"], [17.5822, 12.560, 2.08, "Rasalhague"],
  [14.8451, 74.156, 2.08, "Kochab"], [3.1361, 40.956, 2.09, "Algol"],
  [2.0650, 42.330, 2.10, "Almach"], [11.8177, 14.572, 2.11, "Denebola"],
  [8.0597, -40.003, 2.21, "Naos"], [13.3987, 54.925, 2.23, "Mizar"],
  [5.5334, -0.299, 2.23, "Mintaka"], [20.3705, 40.257, 2.23, "Sadr"],
  [0.6751, 56.537, 2.24, "Schedar"], [0.1529, 59.150, 2.28, "Caph"],
  [21.7364, 9.875, 2.40, "Enif"], [11.0307, 56.383, 2.37, "Merak"],
  [0.9451, 60.717, 2.15, "Gamma Cas"], [23.0629, 28.083, 2.44, "Scheat"],
  [23.0793, 15.205, 2.49, "Markab"], [11.8972, 53.695, 2.44, "Phecda"],
  [1.4303, 60.235, 2.68, "Ruchbah"], [19.5121, 27.960, 3.05, "Albireo"],
  [3.7914, 24.105, 2.87, "Alcyone"], [2.1191, 34.987, 2.64, "Sheratan"],
  [16.0056, -22.622, 2.56, "Dschubba"], [17.7204, -37.104, 2.29, "Lesath"],
  [12.2570, 57.033, 3.31, "Megrez"], [1.9066, 63.670, 3.35, "Segin"],
  [19.7495, 45.131, 2.87, "Fawaris"], [12.2525, -58.749, 2.79, "Delta Cru"],
];

// Linhas das constelações: pares de estrelas (por nome) a unir. Só se desenham
// quando ambas estão acima do horizonte. Ténues, por baixo dos alvos.
const CONSTELLATION_LINES = [
  // Orion
  ["Betelgeuse", "Bellatrix"], ["Betelgeuse", "Alnitak"], ["Bellatrix", "Mintaka"],
  ["Alnitak", "Alnilam"], ["Alnilam", "Mintaka"], ["Alnitak", "Saiph"], ["Mintaka", "Rigel"],
  // Ursa Major (Big Dipper)
  ["Alkaid", "Mizar"], ["Mizar", "Alioth"], ["Alioth", "Megrez"], ["Megrez", "Phecda"],
  ["Phecda", "Merak"], ["Merak", "Dubhe"], ["Dubhe", "Megrez"],
  // Cassiopeia
  ["Segin", "Ruchbah"], ["Ruchbah", "Gamma Cas"], ["Gamma Cas", "Schedar"], ["Schedar", "Caph"],
  // Cygnus (Northern Cross)
  ["Deneb", "Sadr"], ["Sadr", "Albireo"], ["Gienah", "Sadr"], ["Sadr", "Fawaris"],
  // Leo
  ["Regulus", "Algieba"], ["Algieba", "Denebola"], ["Denebola", "Regulus"],
  // Scorpius
  ["Dschubba", "Antares"], ["Antares", "Sargas"], ["Sargas", "Shaula"], ["Shaula", "Lesath"],
  // Crux (Southern Cross)
  ["Acrux", "Gacrux"], ["Mimosa", "Delta Cru"],
  // Gemini
  ["Castor", "Pollux"],
  // Triângulo de Verão (asterismo)
  ["Vega", "Deneb"], ["Deneb", "Altair"], ["Altair", "Vega"],
];

/**
 * Cúpula do céu: a vista de quem olha para cima, e que RODA com a noite.
 * Zénite no centro, horizonte na borda, Norte em cima e Este à esquerda (é
 * assim numa carta vista de baixo, não num mapa). As estrelas brilhantes, a
 * Lua, os planetas e os melhores objectos são plotados nas posições reais
 * (altura e azimute). O slider por baixo varre a noite: arrasta e vê o céu
 * mover-se, os alvos subirem e porem-se. É a peça que mostra o céu em vez de
 * o listar.
 *
 * As posições recalculam-se no cliente a partir de RA/Dec (as mesmas
 * coordenadas que o backend envia) — ver altAz(). A meio da janela recomendada
 * batem com o resto da página, a menos de uns décimos de grau da precessão,
 * invisíveis na cúpula. A Lua é tratada como estrela fixa nas coordenadas do
 * instante médio, por isso deriva alguns graus ao longo da noite.
 */
function buildSkyDome(n, lat, lon, tz) {
  if (skyPlayTimer) { clearInterval(skyPlayTimer); skyPlayTimer = null; }   // pára o play anterior
  const R = 150, cx = 160, cy = 160, S = 320;
  const wrap = el("div", "sky-dome");
  const box = svg("svg", { viewBox: `0 0 ${S} ${S}`, class: "sky" });

  // ---- moldura estática (desenhada uma vez) ----
  box.append(svg("circle", { cx, cy, r: R, fill: "#08070c",
                             stroke: "var(--border-lit)", "stroke-width": 1 }));
  for (const a of [30, 60]) {   // anéis de altura
    box.append(svg("circle", { cx, cy, r: ((90 - a) / 90 * R).toFixed(1), fill: "none",
                               stroke: "var(--border)", "stroke-width": 0.6, "stroke-dasharray": "2 4" }));
  }
  box.append(svg("line", { x1: cx, y1: cy - R, x2: cx, y2: cy + R, stroke: "var(--border)", "stroke-width": 0.5 }),
             svg("line", { x1: cx - R, y1: cy, x2: cx + R, y2: cy, stroke: "var(--border)", "stroke-width": 0.5 }));

  // camada dinâmica: tudo o que se move quando se arrasta o slider
  const layer = svg("g", { class: "sky-dynamic" });
  box.append(layer);

  // rótulos cardeais (estáticos, por cima da camada dinâmica)
  const card = (t, x, y, anchor, baseline) => {
    const e = svg("text", { x, y, "text-anchor": anchor, class: "sky-card" });
    if (baseline) e.setAttribute("dominant-baseline", baseline);
    e.textContent = t; box.append(e);
  };
  card("N", cx, cy - R - 5, "middle", "auto");
  card("S", cx, cy + R + 13, "middle", "auto");
  card("E", cx - R - 6, cy, "end", "middle");
  card("O", cx + R + 6, cy, "start", "middle");

  // ---- popup: dados ao vivo, recalculados à hora do slider ----
  const pop = el("div", "sky-pop");
  pop.hidden = true;
  const showPop = (o, cur) => {
    pop.innerHTML = "";
    const a = el("a", "sky-pop-name", o.name);
    a.href = o.url; a.target = "_blank"; a.rel = "noopener";
    pop.append(a);
    const bits = [o.kind];
    if (o.magnitude !== null && o.magnitude !== undefined) bits.push(`mag ${o.magnitude}`);
    pop.append(el("div", "sky-pop-kind", bits.join(" · ")));
    pop.append(el("div", "sky-pop-line",
      `${Math.round(cur.alt)}° above the horizon, ${skyCompass(cur.az)}`));
    const am = skyAirmass(cur.alt);
    if (am !== null) pop.append(el("div", "sky-pop-line", `airmass ${am.toFixed(1)}`));
    if (o.transit_time) {
      pop.append(el("div", "sky-pop-line",
        `highest at ${hhmm(o.transit_time)} (${Math.round(o.max_altitude_deg)}°)`));
    }
    if (o.washed_out) pop.append(el("div", "sky-pop-warn", "washed out by moonlight"));
    // posição em % do quadrado; limitada para o popup não sair da cúpula (e
    // não criar scroll no telemóvel). Acima do ponto, ou abaixo se no topo.
    pop.style.left = Math.max(20, Math.min(80, cur.x / S * 100)).toFixed(1) + "%";
    pop.style.top = (cur.y / S * 100).toFixed(1) + "%";
    pop.classList.toggle("below", cur.y < S * 0.32);
    pop.hidden = false;
  };
  let hideTimer;
  const hidePop = () => { hideTimer = setTimeout(() => { pop.hidden = true; }, 140); };
  const keepPop = () => clearTimeout(hideTimer);
  pop.addEventListener("mouseenter", keepPop);
  pop.addEventListener("mouseleave", () => { pop.hidden = true; });
  box.addEventListener("click", () => { pop.hidden = true; });   // tocar no fundo fecha

  // altura+azimute -> ponto no disco (N em cima, E à esquerda)
  const pos = (alt, az) => {
    const r = (90 - alt) / 90 * R, A = az * Math.PI / 180;
    return [cx - r * Math.sin(A), cy - r * Math.cos(A)];
  };

  // objectos ordenados do mais fraco para o mais forte (os brilhantes por cima)
  const ordered = [...n.objects].sort((a, b) => (b.magnitude ?? -9) - (a.magnitude ?? -9));

  // ---- desenhar o céu a um instante (UTC) ----
  function draw(utcDate) {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    pop.hidden = true;
    const lst = localSiderealDeg(utcDate, lon);

    // estrelas reais: primeiro as posições, depois as linhas das constelações
    // (por baixo), e por fim os pontos + nomes.
    const starPos = {};
    const starDots = [];
    for (const [raH, decDeg, mag, name] of BRIGHT_STARS) {
      const [alt, az] = altAz(raH, decDeg, lst, lat);
      if (alt <= 0) continue;
      const [x, y] = pos(alt, az);
      starPos[name] = [x, y];
      starDots.push([x, y, mag, name, alt]);
    }
    for (const [a, b] of CONSTELLATION_LINES) {
      const pa = starPos[a], pb = starPos[b];
      if (!pa || !pb) continue;
      layer.append(svg("line", { x1: pa[0].toFixed(1), y1: pa[1].toFixed(1),
                                 x2: pb[0].toFixed(1), y2: pb[1].toFixed(1),
                                 class: "sky-constline" }));
    }
    for (const [x, y, mag, name, alt] of starDots) {
      const r = Math.max(0.5, 1.9 - mag * 0.42);
      const op = Math.max(0.25, 0.95 - mag * 0.16);
      layer.append(svg("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2),
                                   fill: "var(--star)", opacity: op.toFixed(2) }));
      // nomear só as mais brilhantes, para orientar sem competir com os alvos
      if (mag < 1.0 && alt > 12) {
        const t = svg("text", { x: (x + 4).toFixed(1), y: (y - 3).toFixed(1), class: "sky-star-lbl" });
        t.textContent = name; layer.append(t);
      }
    }

    // Objectos recomendados. A cor diz quão alto está — o mesmo código das
    // barras de "O que observar": verde no melhor (>50°), âmbar utilizável
    // (30–50°), apagado quando está baixo demais (<30°) para valer a pena. E
    // todos levam nome, para se identificarem sem passar o rato.
    for (const o of ordered) {
      const [alt, az] = altAz(o.ra_h, o.dec_deg, lst, lat);
      if (alt <= 0) continue;   // pôs-se: desaparece da cúpula
      const [x, y] = pos(alt, az);
      const isMoon = o.kind === "moon", isPlanet = o.kind === "planet";
      const low = alt < 30;
      const tier = alt >= 50 ? "var(--good)" : alt >= 30 ? "var(--ok)" : "var(--faint)";
      let dot;
      if (isMoon) {
        // A Lua não segue os níveis (alta é má em céu profundo): fica ela mesma.
        dot = svg("circle", { cx: x, cy: y, r: 6, fill: "var(--moon)",
                              stroke: "rgba(60,48,28,0.4)", "stroke-width": 0.6 });
      } else {
        const base = isPlanet ? 3.6
                   : o.magnitude !== null ? Math.max(1.6, 4 - o.magnitude * 0.4) : 2.2;
        const r = low ? Math.max(1.4, base - 1) : base;
        const attrs = { cx: x, cy: y, r: (+r).toFixed(1), fill: tier,
                        opacity: (o.washed_out || low) ? 0.5 : 0.95 };
        if (isPlanet) { attrs.stroke = "var(--bg)"; attrs["stroke-width"] = 0.7; }
        dot = svg("circle", attrs);
      }
      layer.append(dot);

      // rótulo na cor do nível (a Lua e os "baixos" num tom neutro legível)
      const lblColor = isMoon ? "var(--moon)" : low ? "var(--dim)" : tier;
      const lx = x + 7, anchor = lx > cx + R - 30 ? "end" : "start";
      const label = svg("text", { x: anchor === "end" ? x - 7 : lx, y: y + 3,
                                  "text-anchor": anchor, class: "sky-lbl",
                                  style: `fill:${lblColor};opacity:${o.washed_out ? 0.6 : 1}` });
      label.textContent = o.name; layer.append(label);

      // área de toque maior e invisível, para os pontos pequenos serem fáceis
      const cur = { x, y, alt, az };
      const hit = svg("circle", { cx: x, cy: y, r: 11, fill: "transparent", class: "sky-hit" });
      hit.addEventListener("mouseenter", () => { keepPop(); showPop(o, cur); });
      hit.addEventListener("mouseleave", hidePop);
      hit.addEventListener("click", (e) => { e.stopPropagation(); showPop(o, cur); });
      layer.append(hit);
    }
  }

  wrap.append(box, pop);

  // ---- slider de tempo ----
  // Varre a MESMA janela horária das barras de "O que observar" e do meteograma
  // (do início ao fim da noite mostrada), para os três baterem certo.
  const wall = (iso) => localWallToUTC(iso, tz).getTime();
  const hrsArr = n.hours || [];
  const t0 = wall(hrsArr.length ? hrsArr[0].time : (n.night_start || n.window_start));
  const t1 = wall(hrsArr.length ? hrsArr[hrsArr.length - 1].time : (n.night_end || n.window_end));
  const tMid = (wall(n.window_start) + wall(n.window_end)) / 2;

  // Sem noite válida (caso raro): desenha só o instante médio, sem slider.
  if (!isFinite(t0) || !isFinite(t1) || t1 <= t0) {
    draw(new Date(isFinite(tMid) ? tMid : t0));
    return wrap;
  }

  const control = el("div", "sky-time");
  const label = el("div", "sky-time-lbl");
  const fmt = new Intl.DateTimeFormat("en-GB",
    { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const slider = el("input", "sky-slider");
  slider.type = "range";
  slider.min = String(Math.round(t0));
  slider.max = String(Math.round(t1));
  slider.step = String(5 * 60 * 1000);   // passos de 5 minutos
  slider.value = String(Math.round(Math.min(Math.max(tMid, t0), t1)));
  slider.setAttribute("aria-label", "Time of night");

  // Faixa da escuridão total (dusk→dawn) destacada no fundo do slider, com a
  // hora marcada em cada aresta — fora dela, o Sol ainda clareia o céu.
  const span = t1 - t0;
  const markPct = (iso) => Math.max(0, Math.min(100, (wall(iso) - t0) / span * 100));
  let darkMarks = null;
  if (n.dusk && n.dawn) {
    const p0 = markPct(n.dusk), p1 = markPct(n.dawn);
    if (p1 - p0 > 1 && (p0 > 1 || p1 < 99)) {
      slider.style.background =
        `linear-gradient(90deg, var(--border-lit) ${p0.toFixed(1)}%,` +
        ` rgba(224,152,94,0.45) ${p0.toFixed(1)}%, rgba(224,152,94,0.45) ${p1.toFixed(1)}%,` +
        ` var(--border-lit) ${p1.toFixed(1)}%)`;
      darkMarks = el("div", "sky-marks");
      const put = (iso) => {
        const m = el("span", "sky-mark", fmt.format(new Date(wall(iso))));
        m.style.left = markPct(iso).toFixed(1) + "%";
        darkMarks.append(m);
      };
      put(n.dusk); put(n.dawn);
    }
  }

  const update = () => {
    const d = new Date(Number(slider.value));
    label.textContent = fmt.format(d);
    draw(d);
  };

  // ---- botão play: anima o slider ao longo da noite ----
  const play = el("button", "sky-play");
  play.type = "button"; play.textContent = "▶"; play.setAttribute("aria-label", "Play");
  const stopPlay = () => {
    if (skyPlayTimer) { clearInterval(skyPlayTimer); skyPlayTimer = null; }
    play.textContent = "▶"; play.setAttribute("aria-label", "Play");
  };
  const startPlay = () => {
    play.textContent = "⏸"; play.setAttribute("aria-label", "Pause");
    // Acumulador próprio: o `step` do slider (5 min) faria o valor "encaixar" e
    // não avançar. Desenhamos na posição real (suave) e movemos o thumb à parte.
    let posMs = Number(slider.value), tickMs = 60, inc = (t1 - t0) * tickMs / 14000;
    skyPlayTimer = setInterval(() => {
      posMs += inc;
      if (posMs >= t1) posMs = t0;            // recomeça no início da noite
      slider.value = String(Math.round(posMs));
      const d = new Date(posMs);
      label.textContent = fmt.format(d);
      draw(d);
    }, tickMs);
  };
  play.addEventListener("click", () => { skyPlayTimer ? stopPlay() : startPlay(); });
  // arrastar o slider pausa a animação
  slider.addEventListener("input", () => { stopPlay(); update(); });

  const sliderWrap = el("div", "sky-slider-wrap");
  sliderWrap.append(slider);
  if (darkMarks) sliderWrap.append(darkMarks);
  const row = el("div", "sky-time-row");
  row.append(play, sliderWrap);
  control.append(label, row);
  wrap.append(control);

  update();   // primeira pintura, à hora recomendada
  return wrap;
}

/** Sparkline sem eixos nem números: só a forma, para se ver a tendência. */
function sparkline(values, invert) {
  const vals = values.filter((v) => v !== null && v !== undefined);
  const box = svg("svg", { class: "spark", viewBox: "0 0 60 18",
                           preserveAspectRatio: "none", "aria-hidden": "true" });
  if (vals.length < 2) return box;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 60;
    if (v === null || v === undefined) return null;
    let t = (v - lo) / span;
    if (invert) t = 1 - t;                 // menos é melhor → desenha para baixo
    return `${x.toFixed(1)},${(16 - t * 14).toFixed(1)}`;
  }).filter(Boolean).join(" ");
  box.append(svg("polyline", { points: pts, fill: "none", stroke: "var(--faint)",
                               "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }));
  return box;
}

function iconSVG(name, size = 20, cls = "icon") {
  const g = svg("svg", { width: size, height: size, viewBox: "0 0 24 24", class: cls,
                         fill: "none", stroke: "currentColor", "stroke-width": 1.7,
                         "stroke-linecap": "round", "stroke-linejoin": "round",
                         "aria-hidden": "true" });
  const paths = {
    // Só onde existe convenção. Seeing e transparência ficam em palavras.
    cloud: ["M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.6A3.5 3.5 0 0 0 6.5 19z"],
    droplet: ["M12 3.5 6.8 9.9a7 7 0 1 0 10.4 0z"],
    thermo: ["M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"],
  }[name] || [];
  for (const d of paths) g.append(svg("path", { d }));
  return g;
}

/* ------------------------------------------------- geocodificação */

let preferredCountry = (() => {
  try {
    const saved = localStorage.getItem(COUNTRY_KEY);
    if (saved) return saved;
  } catch { /* localStorage indisponível */ }
  const m = /-([A-Z]{2})$/.exec(navigator.language || "");
  return m ? m[1] : null;
})();

function rememberCountry(code) {
  if (!code || code === preferredCountry) return;
  preferredCountry = code;
  try { localStorage.setItem(COUNTRY_KEY, code); } catch { /* ignorar */ }
}

async function geocodeRequest(name, count, countryCode) {
  let url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=${count}&language=en&format=json`;
  if (countryCode) url += `&countryCode=${countryCode}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding failed");
  return (await res.json()).results || [];
}

/** A API ordena por relevância global e enterra localidades pequenas. */
async function geocodeMany(name, count = 6) {
  const [local, global_] = await Promise.all([
    preferredCountry ? geocodeRequest(name, count, preferredCountry).catch(() => []) : [],
    geocodeRequest(name, count).catch(() => []),
  ]);
  const seen = new Set();
  const merged = [];
  for (const r of [...local, ...global_]) {
    const key = r.id ?? `${r.latitude},${r.longitude}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged.slice(0, count);
}

function placeLabel(r) {
  const parts = [r.name];
  if (r.admin1 && r.admin1 !== r.name) parts.push(r.admin1);
  if (r.country_code) parts.push(r.country_code);
  return parts.join(", ");
}

async function geocode(name) {
  let results = await geocodeMany(name, 1);
  // O rótulo completo (com distrito e país) não é geocodificável; recua para
  // só o nome, antes da primeira vírgula.
  if (!results.length && name.includes(",")) {
    results = await geocodeMany(name.split(",")[0].trim(), 1);
  }
  if (!results.length) throw new Error(`Location "${name}" not found`);
  const r = results[0];
  rememberCountry(r.country_code);
  return { lat: r.latitude, lon: r.longitude, label: placeLabel(r) };
}

/* ------------------------------------------------- dados */

async function loadForecast(keepDate) {
  if (!current) return;
  setStatus(`Working out the nights for ${current.label}…`);
  resultEl.hidden = true;
  // O plano gratuito do Render adormece; a primeira resposta do dia demora a
  // acordar. Avisar em vez de deixar a pessoa achar que travou.
  const waking = setTimeout(
    () => setStatus("Waking the server… the first visit of the day can take up to 1 min."),
    4000);
  try {
    lastData = await computeForecast(current.lat, current.lon, mode);
    if (!keepDate) selectedDate = null;
    render();
    saveBtn.hidden = false;
    setStatus("");
  } catch (e) {
    setStatus(`⚠️ ${e.message}`);
  } finally {
    clearTimeout(waking);
  }
}

/* ------------------------------------------------- classificações */

const scoreClass = (s, usable) =>
  !usable ? "s-none" : s >= 55 ? "s-good" : s >= 35 ? "s-ok" : "s-poor";
const stripClass = (s, usable) =>
  !usable ? "q-none" : s >= 55 ? "q-good" : s >= 35 ? "q-ok" : "q-poor";

function cellClass(kind, v) {
  if (v === null || v === undefined) return "c-flat";
  if (kind === "cloud") return v < 25 ? "c-good" : v < 60 ? "c-ok" : "c-poor";
  if (kind === "jet") return v < 60 ? "c-good" : v < 100 ? "c-ok" : "c-poor";
  if (kind === "moon") return v <= 0 ? "c-good" : v < 15 ? "c-ok" : "c-poor";
  if (kind === "spread") return v >= 5 ? "c-good" : v >= 2.5 ? "c-ok" : "c-poor";
  return "c-flat";
}

// Limiares por airmass: verde só < 1.3 (acima de ~50°, o objecto no seu
// melhor), âmbar até 2.0 (~30°), abaixo não vale a pena mostrar barra. É isto
// que faz o verde significar "é agora" e o padrão em escada ser o plano.
function barClass(alt) {
  if (alt === null || alt < 30) return "b-none";
  return alt >= 50 ? "b-good" : "b-ok";
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const weekdayShort = (d) =>
  cap(new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" }).replace(".", ""));
const weekdayLong = (d) =>
  cap(new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }));

/* ------------------------------------------------- painéis */

/** Secção sem moldura: só um rótulo pequeno e o conteúdo. É o que tira o
 *  "caixas dentro de caixas" — a separação é feita por espaço, não por bordas. */
function block(label, node, aside) {
  const b = el("section", "block");
  if (label) {
    const head = el("div", "block-head");
    head.append(el("span", "block-label", label));
    if (aside) head.append(aside);
    b.append(head);
  }
  b.append(node);
  return b;
}

/** Factores limitantes, separados por natureza: a poluição luminosa é do
 *  *sítio* (constante, nada a fazer hoje); a Lua/seeing/nuvens são desta
 *  *noite*. Misturá-los sugeria que havia algo a mudar hoje quanto ao Bortle. */
function buildLimits(n, lp) {
  const box = el("div", "limits");
  if (!n.limiting.length) {
    box.append(el("div", "limits-none", "Nothing holding it back — conditions at their best."));
    return box;
  }
  const night = n.limiting.filter((f) => f.factor !== "poluicao");
  const worst = Math.max(1, ...night.map((f) => f.cost_points));

  const barRow = (name, cost) => {
    const row = el("div", "limit");
    row.append(el("span", "limit-name", name));
    const track = el("div", "limit-track");
    const fill = el("div", "limit-fill");
    fill.style.width = `${Math.max(8, (cost / worst) * 100)}%`;
    fill.style.background = cost >= worst * 0.66 ? "var(--poor)"
      : cost >= worst * 0.33 ? "var(--ok)" : "var(--good)";
    track.append(fill);
    row.append(track, el("span", "limit-cost", `−${cost}`));
    return row;
  };

  if (lp) {
    // A poluição luminosa é constante: mostra-se a % que corta sempre, não um
    // valor em pontos que engana por variar com a noite.
    box.append(el("div", "limit-group", "This place"));
    const row = el("div", "limit");
    row.append(el("span", "limit-name", `light pollution · Bortle ${lp.bortle}`));
    const track = el("div", "limit-track");
    const fill = el("div", "limit-fill");
    fill.style.width = `${Math.max(8, lp.cut_pct)}%`;
    fill.style.background = lp.cut_pct >= 45 ? "var(--poor)"
      : lp.cut_pct >= 20 ? "var(--ok)" : "var(--good)";
    track.append(fill);
    row.append(track, el("span", "limit-cost", `−${lp.cut_pct}%`));
    box.append(row);
  }
  if (night.length) {
    box.append(el("div", "limit-group", "Tonight"));
    for (const f of night) box.append(barRow(f.label, f.cost_points));
  }
  return box;
}

/** Uma condição: ícone/Lua, o valor legível, e a mini-curva com escala. */
function condItem({ icon, tag, value, spark, moon }) {
  const c = el("div", "cond");
  const head = el("div", "cond-head");
  head.append(moon || icon || el("span"), el("span", "cond-tag", tag));
  c.append(head, el("div", "cond-value", value));
  if (spark) c.append(spark);
  return c;
}

function buildConds(n) {
  const grid = el("div", "conds");
  const c = n.cards;

  grid.append(condItem({
    moon: moonSVG(n.moon_illumination_pct, n.moon_waxing, 22),
    tag: "Moon",
    value: n.moon_phase,
    spark: el("div", "cond-note", `${Math.round(n.moon_illumination_pct)}% lit`),
  }));

  grid.append(condItem({
    icon: iconSVG("cloud"), tag: "Clouds",
    value: c ? c.clouds_label : "—",
    spark: c ? scaledSpark(c.clouds_spark, "%", true, 25) : null,
  }));

  const dewWarn = c && /Likely|Possible/.test(c.dew_label);
  grid.append(condItem({
    icon: iconSVG("droplet", 20, dewWarn ? "icon warn" : "icon"), tag: "Dew",
    value: c ? c.dew_label : "—",
    spark: c ? scaledSpark(c.dew_spark, "°", false, 3) : null,
  }));

  grid.append(condItem({
    icon: iconSVG("thermo"), tag: "Temperature",
    value: c ? c.temp_label : "—",
    spark: el("div", "cond-note",
      [n.wind_kmh !== null ? `wind ${Math.round(n.wind_kmh)} km/h` : "",
       `seeing ${n.seeing}`].filter(Boolean).join(" · ")),
  }));

  return grid;
}

/**
 * Sparkline com escala. A área e a linha ficam confinadas ao viewBox com uma
 * margem interna, e a escala (mín–máx) vai por baixo, em fluxo — não flutua
 * por cima do SVG. Série constante (ex.: nuvens a 0% a noite toda) desenha uma
 * linha centrada, não rasa no fundo, para não parecer um gráfico partido.
 */
function fmtVal(v, unit) {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;
}

function scaledSpark(values, unit, invert, threshold) {
  const wrap = el("div", "sspark");
  const real = values.filter((v) => v !== null && v !== undefined);
  if (real.length < 2) return wrap;

  const lo = Math.min(...real), hi = Math.max(...real);
  const constant = hi - lo < 1e-6;
  const PAD = 4, TOP = PAD, BOT = 24 - PAD;   // viewBox 0..24 de altura
  const y = (v) => {
    if (constant) return 12;
    let t = (v - lo) / (hi - lo);
    if (invert) t = 1 - t;                     // menos é melhor → desce
    return BOT - t * (BOT - TOP);
  };
  const pts = values.map((v, i) => v === null || v === undefined ? null
    : `${((i / (values.length - 1)) * 100).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean);

  const box = svg("svg", { class: "sspark-svg", viewBox: "0 0 100 24",
                           preserveAspectRatio: "none", "aria-hidden": "true" });
  if (!constant && threshold >= lo && threshold <= hi) {
    const yt = y(threshold).toFixed(1);
    box.append(svg("line", { x1: 0, y1: yt, x2: 100, y2: yt,
      stroke: "var(--border-lit)", "stroke-width": 0.7, "stroke-dasharray": "2 2",
      "vector-effect": "non-scaling-stroke" }));
  }
  box.append(svg("polyline", { points: `0,24 ${pts.join(" ")} 100,24`,
    fill: "rgba(224,152,94,0.08)", stroke: "none" }));
  box.append(svg("polyline", { points: pts.join(" "), fill: "none",
    stroke: "var(--dim)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" }));

  const scale = el("div", "sspark-scale");
  if (constant) {
    scale.append(el("span", null, fmtVal(lo, unit)));
  } else {
    // ordem por magnitude, para se ler o intervalo da noite
    scale.append(el("span", null, fmtVal(lo, unit)), el("span", null, fmtVal(hi, unit)));
  }
  wrap.append(box, scale);
  return wrap;
}

/* --- meteograma: horas em colunas, variáveis em linhas --- */

// As horas fora da janela recomendada aparecem esbatidas, para a janela se
// destacar sem esconder o resto da noite.
function timeHeader(hours) {
  const row = el("div", "tgrid");
  row.append(el("div"));
  for (const h of hours) {
    row.append(el("div", "tgrid-head" + (h.in_window ? " in-win" : ""), hh(h.time)));
  }
  return row;
}

function meteoRow(label, hours, kind, fmt) {
  const row = el("div", "tgrid heat");
  row.append(el("div", "tgrid-label", label));
  hours.forEach((h, i) => {
    const v = kind === "cloud" ? h.cloud_total_pct
      : kind === "jet" ? h.jet_stream_kmh
      : kind === "moon" ? h.moon_altitude_deg
      : kind === "spread" ? h.dew_spread_c
      : h.temperature_c;
    const cell = el("div", `cell ${cellClass(kind, v)}` + (h.in_window ? "" : " out"), fmt(v));
    if (i === 0) cell.classList.add("cell-first");
    if (i === hours.length - 1) cell.classList.add("cell-last");
    row.append(cell);
  });
  return row;
}

function buildMeteogram(hours) {
  // Bandas contínuas em vez de dezenas de caixinhas, sobre a noite escura toda.
  const box = el("div");
  box.append(timeHeader(hours));
  box.append(meteoRow("clouds", hours, "cloud", (v) => v === null ? "—" : `${Math.round(v)}%`));
  box.append(meteoRow("seeing", hours, "jet",
    (v) => v === null ? "—" : v < 60 ? "good" : v < 100 ? "fair" : "poor"));
  box.append(meteoRow("Moon", hours, "moon",
    (v) => v === null ? "—" : v <= 0 ? "set" : `${Math.round(v)}°`));
  box.append(meteoRow("dew margin", hours, "spread", (v) => v === null ? "—" : `${v.toFixed(1)}°`));
  box.append(meteoRow("temp", hours, "temp", (v) => v === null ? "—" : `${Math.round(v)}°`));
  return box;
}

/* --- janelas dos objectos: uma barra por alvo --- */

// Cada alvo: uma linha de texto legível (o que é e quando está no seu melhor)
// e, por baixo, a barra alinhada ao mesmo eixo horário do meteograma.
function objectItem(o, hours) {
  const item = el("div", "obj-item" + (o.washed_out ? " is-washed" : ""));

  const info = el("div", "obj-info");
  info.append(symbolSVG(o.symbol, 15));
  const a = el("a", "obj-name", o.name);
  a.href = o.url; a.target = "_blank"; a.rel = "noopener";
  a.title = `Ver ${o.name} no Telescopius`;
  info.append(a);

  const quando = o.transit_time
    ? `highest at ${hhmm(o.transit_time)} (${Math.round(o.max_altitude_deg)}°)`
    : `${o.trend}, up to ${Math.round(o.max_altitude_deg)}°`;
  const bits = [o.kind];
  if (o.magnitude !== null) bits.push(`mag ${o.magnitude}`);
  bits.push(quando);
  if (o.airmass !== null) bits.push(`airmass ${o.airmass.toFixed(1)}`);
  if (o.washed_out) bits.push("washed out by moonlight");
  info.append(el("span", "obj-meta", bits.join(" · ")));
  item.append(info);

  const track = el("div", "tgrid");
  track.append(el("div"));   // espaçador da largura do rótulo, para alinhar
  o.altitudes.forEach((alt, i) => {
    const inWin = hours[i] && hours[i].in_window;
    const cell = el("div", `bar ${barClass(alt)}` + (inWin ? "" : " out"));
    if (alt !== null) cell.title = `${hh(hours[i].time)} · ${Math.round(alt)}°`;
    track.append(cell);
  });
  item.append(track);
  return item;
}

// Grupos de filtro: rótulo → tipos de símbolo que abrange.
const OBJECT_GROUPS = [
  ["All", null],
  ["Galaxies", ["galaxy"]],
  ["Nebulae", ["nebula", "planetary"]],
  ["Clusters", ["open_cluster", "globular"]],
  ["Planets", ["planet", "moon", "double"]],
];

function buildObjectsFilter(n, hours) {
  const box = el("div");
  const rows = el("div", "obj-rows");
  const legend = el("div", "legend");
  const mk = (cls, txt) => {
    const s = el("span");
    const sw = el("span", "swatch");
    sw.style.background = cls;
    s.append(sw, document.createTextNode(txt));
    return s;
  };
  legend.append(mk("var(--good)", "Best (>50°)"), mk("var(--ok)", "Usable (30–50°)"),
                mk("var(--faint)", "Low (<30°)"));

  let active = null;    // conjunto de símbolos, ou null = tudo
  let expanded = false;

  function draw() {
    rows.innerHTML = "";
    rows.append(timeHeader(hours));
    const matches = n.objects.filter((o) => !active || active.includes(o.symbol));
    const visible = expanded ? matches : matches.slice(0, TOP_OBJECTS);
    for (const o of visible) rows.append(objectItem(o, hours));

    if (!matches.length) {
      rows.append(el("div", "obj-empty", "None of this type above the horizon."));
    } else if (matches.length > TOP_OBJECTS && !expanded) {
      const more = el("button", "more", `See the other ${matches.length - TOP_OBJECTS}`);
      more.type = "button";
      more.addEventListener("click", () => { expanded = true; draw(); });
      rows.append(more);
    }
  }

  const chips = el("div", "filters");
  OBJECT_GROUPS.forEach(([label, syms], idx) => {
    // só mostra o filtro se houver objectos desse tipo
    if (syms && !n.objects.some((o) => syms.includes(o.symbol))) return;
    const chip = el("button", "chip" + (idx === 0 ? " is-active" : ""), label);
    chip.type = "button";
    chip.addEventListener("click", () => {
      active = syms;
      expanded = false;
      chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c === chip));
      draw();
    });
    chips.append(chip);
  });

  draw();
  box.append(chips, rows, legend);
  return box;
}

/* --- eventos e dados crus --- */

/** Pill de condição em linguagem simples, como nos sites de meteorologia. */
function conditionPill(n) {
  const c = n.cloud_cover_pct;
  let label = "sem dados", cls = "";
  if (c !== null && c !== undefined) {
    if (c < 15) { label = "clear sky"; cls = "pill-good"; }
    else if (c < 40) { label = "few clouds"; cls = "pill-ok"; }
    else { label = "lots of cloud"; cls = "pill-poor"; }
  }
  const pill = el("span", "pill " + cls);
  pill.append(iconSVG("cloud", 13), document.createTextNode(label));
  return pill;
}

/**
 * Banda de luz: do pôr ao nascer do Sol, com o crepúsculo a esbater nas pontas,
 * a noite escura ao meio, a janela recomendada em destaque e o período com a
 * Lua no céu marcado. Dá orientação e presença — como a barra do Telescopius.
 */
function buildDaylightBand(n) {
  if (!n.sun_set || !n.sun_rise) return null;
  const t = (iso) => new Date(iso).getTime();
  const start = t(n.sun_set), end = t(n.sun_rise), span = end - start || 1;
  const pct = (iso) => iso ? Math.max(0, Math.min(100, (t(iso) - start) / span * 100)) : null;

  const box = el("div", "band");

  // Linha de cima: a Lua, quando se põe (fica sozinha, não colide com a janela).
  const above = el("div", "band-above");
  const msP = pct(n.moonset);
  if (msP !== null) {
    const m = el("span", "band-mark band-mark-moon band-mark-mid", `☾ ${hhmm(n.moonset)}`);
    m.style.left = msP + "%";
    above.append(m);
  }

  const track = el("div", "band-track");
  const duskP = pct(n.dusk) ?? 15, dawnP = pct(n.dawn) ?? 85;
  track.style.background =
    `linear-gradient(90deg, #3a2612 0%, #0a0908 ${duskP.toFixed(0)}%, ` +
    `#0a0908 ${dawnP.toFixed(0)}%, #3a2612 100%)`;

  // Lua no céu: região visível de quando nasce (ou do início) até se pôr; a
  // aresta direita, na cor da Lua, é o instante em que se põe.
  if (n.moonset || n.moonrise) {
    const up = el("div", "band-moon");
    const a = pct(n.moonrise) ?? 0, b = msP ?? 100;
    up.style.left = Math.min(a, b) + "%";
    up.style.width = Math.max(1, Math.abs(b - a)) + "%";
    track.append(up);
  }

  // Janela óptima em destaque, com as arestas (início/fim) marcadas.
  const wa = pct(n.window_start), wb = pct(n.window_end);
  if (wa !== null && wb !== null) {
    const win = el("div", "band-window");
    win.style.left = wa + "%"; win.style.width = Math.max(1.5, wb - wa) + "%";
    track.append(win);
  }
  box.append(above, track);

  // Linha de baixo: pôr e nascer do Sol nas pontas, e as horas da janela óptima
  // nos seus lugares (a cheio, em destaque).
  const below = el("div", "band-below");
  const endMark = (side, text) => {
    const m = el("span", "band-mark band-mark-sun", text);
    m.style[side] = "0";
    below.append(m);
  };
  endMark("left", `☀ ${hhmm(n.sun_set)}`);
  const winMark = (posPct, iso) => {
    if (posPct === null) return;
    const m = el("span", "band-mark band-mark-win band-mark-mid", hhmm(iso));
    m.style.left = posPct + "%";
    below.append(m);
  };
  winMark(wa, n.window_start);
  winMark(wb, n.window_end);
  endMark("right", `☀ ${hhmm(n.sun_rise)}`);
  box.append(below);

  return box;
}

/** Faixa fina de destaques da noite, logo abaixo do veredicto — em vez de uma
 *  caixa perdida no fim. Só aparece quando há algo a assinalar. */
function buildHighlights(n) {
  const iss = n.iss_passes || [];
  if (!n.meteor_shower && !n.milky_way && !iss.length) return null;
  const box = el("div", "highlights");
  const add = (icon, name, text) => {
    const row = el("div", "hl");
    row.append(el("span", "hl-icon", icon), el("span", "hl-name", name),
               el("span", "hl-text", text));
    box.append(row);
  };
  if (n.meteor_shower) {
    const m = n.meteor_shower;
    add("☄️", m.name,
      `${m.summary} Radiant at ${Math.round(m.radiant_altitude_deg)}° ${m.radiant_direction}.`);
  }
  if (n.milky_way) {
    const g = n.milky_way;
    add("🌌", "Milky Way",
      `${g.summary}${g.transit_time ? ` Highest at ${hhmm(g.transit_time)}.` : ""}`);
  }
  for (const p of iss) {
    add("🛰️", "ISS pass",
      `${hhmm(p.start)}–${hhmm(p.end)}, peaks ${Math.round(p.peak_altitude_deg)}° `
      + `to the ${p.peak_direction} (rises ${p.rise_direction}, sets ${p.set_direction}).`);
  }
  return box;
}

/** "Will I see the ISS?" — a section that always answers: visible this week,
 *  when it comes back, or nothing on the horizon. The ISS is only visible in
 *  the weeks its orbit catches the sun at dusk/dawn, so many weeks show none. */
function buildISSOutlook(data) {
  const iss = data.iss;
  if (!iss) return null;
  const p = iss.next_pass;
  const where = p && `up to ${Math.round(p.peak_altitude_deg)}° ${p.peak_direction}`;
  let text;
  if (iss.visible_this_week && p) {
    text = `Visible this week — soonest ${weekdayShort(p.start.slice(0, 10))} `
      + `at ${hhmm(p.start)}, ${where}. Passes are marked on their nights above.`;
  } else if (p) {
    text = `Not visible this week. The ISS returns to the sky around `
      + `${weekdayLong(p.start.slice(0, 10))} — first pass at ${hhmm(p.start)}, `
      + `${where}. Dates this far ahead are approximate.`;
  } else {
    text = `Not visible from here for at least the next ${iss.horizon_days} days. `
      + `The ISS only shows in the weeks its orbit catches the sunlight at dusk `
      + `or dawn — check back later.`;
  }
  const box = el("div", "highlights");
  const row = el("div", "hl");
  row.append(el("span", "hl-icon", "🛰️"), el("span", "hl-name", "ISS"),
             el("span", "hl-text", text));
  box.append(row);
  return block("Space station (ISS)", box);
}

/** Resumo da noite em texto, das peças que já existem (sem AI) — para copiar ou
 *  partilhar. É só juntar o que o site já sabe numa frase que se envia a um amigo. */
function nightSummaryText(data, n) {
  const place = (current && current.label) || "";
  const day = n.in_progress ? "Tonight" : weekdayLong(n.date);
  const usable = n.window_start !== null;
  const lines = [];

  lines.push(usable ? `${place} · ${day} — ${n.verdict} (${n.score}/100)`
                    : `${place} · ${day} — ${n.headline}`);
  if (usable) lines.push(`Dark window ${hhmm(n.window_start)}–${hhmm(n.window_end)}.`);

  const c = n.cards, cond = [];
  if (c && c.clouds_label) cond.push(c.clouds_label);
  if (n.seeing) cond.push(`seeing ${n.seeing}`);
  if (c && c.dew_label) cond.push(`dew ${c.dew_label.toLowerCase()}`);
  if (cond.length) lines.push(cond.join(" · ") + ".");

  if (n.moon_phase) {
    lines.push(`${n.moon_phase}, ${Math.round(n.moon_illumination_pct)}% lit`
      + (n.moonset ? `, sets ${hhmm(n.moonset)}.` : "."));
  }
  const lp = data.light_pollution;
  if (lp) lines.push(`Sky: ${lp.description} (Bortle ${lp.bortle}).`);

  const hi = [];
  if (n.meteor_shower) hi.push(n.meteor_shower.name);
  if (n.milky_way) hi.push("Milky Way visible");
  if (n.iss_passes && n.iss_passes.length) hi.push(`ISS pass ${hhmm(n.iss_passes[0].start)}`);
  if (hi.length) lines.push(`Highlights: ${hi.join(", ")}.`);

  if (n.objects && n.objects.length) {
    lines.push(`Targets: ${n.objects.slice(0, 3).map((o) => o.name).join(", ")}.`);
  }
  lines.push("astrowe.onrender.com");
  return lines.join("\n");
}

/** Copia texto com recuo para `execCommand` quando o clipboard moderno falha
 *  (sem foco, contexto não seguro, browsers antigos). */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* cai no recuo abaixo */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

function buildNightSummary(data, n) {
  const text = nightSummaryText(data, n);
  const body = el("p", "night-summary");
  body.textContent = text;

  const actions = el("div", "summary-actions");
  const copyBtn = el("button", "btn-ghost", "Copy");
  copyBtn.type = "button";
  copyBtn.addEventListener("click", async () => {
    copyBtn.textContent = (await copyText(text)) ? "Copied ✓" : "Copy failed";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
  });
  actions.append(copyBtn);
  if (navigator.share) {
    const shareBtn = el("button", "btn-ghost", "Share");
    shareBtn.type = "button";
    shareBtn.addEventListener("click", () => {
      navigator.share({ text, url: "https://astrowe.onrender.com/" }).catch(() => {});
    });
    actions.append(shareBtn);
  }
  return block("Night summary", body, actions);
}

const RAW_COLUMNS = [
  ["Time", (h) => hhmm(h.time)],
  ["Qual.", (h) => `${(h.quality * 100).toFixed(0)}%`],
  ["L/M/H", (h) => `${num(h.cloud_low_pct)}/${num(h.cloud_mid_pct)}/${num(h.cloud_high_pct)}`],
  ["Total", (h) => `${num(h.cloud_total_pct)}%`],
  ["Temp", (h) => `${num(h.temperature_c, 1)}°`],
  ["Dew", (h) => `${num(h.dew_point_c, 1)}°`],
  ["Spread", (h) => `${num(h.dew_spread_c, 1)}°`],
  ["RH", (h) => `${num(h.humidity_pct)}%`],
  ["Wind", (h) => num(h.wind_speed_kmh)],
  ["Gust", (h) => num(h.wind_gusts_kmh)],
  ["Jet", (h) => num(h.jet_stream_kmh)],
  ["Visib.", (h) => (h.visibility_m == null ? "—" : `${(h.visibility_m / 1000).toFixed(0)}km`)],
  ["Moon alt", (h) => `${num(h.moon_altitude_deg)}°`],
  ["Moon %", (h) => num(h.moon_illumination_pct)],
  ["Prec.", (h) => `${num(h.precipitation_prob_pct)}%`],
];

function buildRaw(hours) {
  const wrap = el("div", "raw-wrap");
  const table = el("table", "raw-table");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const [label] of RAW_COLUMNS) hr.append(el("th", null, label));
  thead.append(hr);
  const tbody = document.createElement("tbody");
  for (const h of hours) {
    const tr = document.createElement("tr");
    if (h.in_window) tr.className = "in-window";
    for (const [, fn] of RAW_COLUMNS) tr.append(el("td", null, fn(h)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

/* ------------------------------------------------- render */

function renderStrip(data) {
  stripEl.innerHTML = "";
  const usableNights = data.nights.filter((n) => n.score > 0);
  const bestDate = usableNights.length
    ? usableNights.reduce((a, b) => (b.score > a.score ? b : a)).date : null;

  for (const n of data.nights) {
    const usable = n.window_start !== null;
    // A melhor noite fica sempre destacada (is-best); a seleccionada leva a
    // moldura de acento (is-selected). Por defeito a seleccionada é a mais
    // próxima, por isso divergem sempre que a melhor não é a de hoje.
    const b = el("button", `night-btn ${stripClass(n.score, usable)}` +
                           (n.date === bestDate ? " is-best" : "") +
                           (n.date === selectedDate ? " is-selected" : ""));
    b.type = "button";
    const dt = new Date(n.date + "T12:00:00");
    b.append(el("span", "d", n.in_progress ? "Now" : `${weekdayShort(n.date)} ${dt.getDate()}`),
             el("span", "n", usable ? String(n.score) : "—"),
             moonSVG(n.moon_illumination_pct, n.moon_waxing, 20));
    b.title = `${n.in_progress ? "Tonight" : weekdayLong(n.date)}: ${n.headline}`;
    b.addEventListener("click", () => { selectedDate = n.date; render(); });
    stripEl.append(b);
  }
}

function renderDetail(n) {
  detailEl.innerHTML = "";
  const usable = n.window_start !== null;

  // Veredicto: o herói. Uma frase grande, a razão por baixo, e logo ali os
  // factores que baixam o score — sem painel meio vazio à parte.
  const v = el("div", "verdict");
  const ring = el("div", `verdict-score ${scoreClass(n.score, usable)}`,
                  usable ? String(n.score) : "—");
  const body = el("div", "verdict-body");
  const headRow = el("div", "verdict-headrow");
  headRow.append(el("span", "verdict-head", n.headline));
  if (usable) headRow.append(conditionPill(n));
  body.append(headRow);
  const dayLabel = n.in_progress ? "Tonight" : weekdayLong(n.date);
  body.append(el("div", "verdict-sub", usable
    ? `${dayLabel} · ${hhmm(n.window_start)}–${hhmm(n.window_end)}`
    : `${dayLabel} · ${n.conditions}`));

  // A decisão está à vista; a razão só se a pessoa a quiser, atrás de um clique.
  if (usable) {
    const limits = buildLimits(n, lastData && lastData.light_pollution);
    limits.hidden = true;
    const why = el("button", "why-toggle", "What lowers the score");
    why.type = "button";
    why.addEventListener("click", () => {
      limits.hidden = !limits.hidden;
      why.classList.toggle("is-open", !limits.hidden);
    });
    body.append(why, limits);
  }
  v.append(ring, body);
  // A Lua grande à direita: a imagem do céu que dá presença ao herói.
  const moonHero = el("div", "verdict-moon");
  moonHero.append(moonSVG(n.moon_illumination_pct, n.moon_waxing, 66),
                  el("span", "verdict-moon-lbl",
                     `${Math.round(n.moon_illumination_pct)}%`));
  v.append(moonHero);
  detailEl.append(v);

  const band = buildDaylightBand(n);
  if (band) detailEl.append(band);

  if (!n.hours.length) return;
  // A noite escura toda, não só a janela — a janela fica em destaque.
  const hrs = n.hours;
  detailEl.style.setProperty("--cols", String(hrs.length));

  const hl = buildHighlights(n);
  if (hl) detailEl.append(hl);

  detailEl.append(block("Conditions", buildConds(n)));

  const issOutlook = buildISSOutlook(lastData);
  if (issOutlook) detailEl.append(issOutlook);

  detailEl.append(buildNightSummary(lastData, n));

  const raw = buildRaw(hrs);
  raw.hidden = true;
  const toggle = el("button", "raw-toggle", "Full table");
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    raw.hidden = !raw.hidden;
    toggle.classList.toggle("is-open", !raw.hidden);
  });
  const meteo = el("div");
  meteo.append(buildMeteogram(hrs), raw);
  detailEl.append(block("The night, hour by hour", meteo, toggle));

  if (n.objects.length) {
    // Cúpula: o céu visto de baixo, com slider para varrer a noite.
    const wrap = el("div", "sky-wrap");
    wrap.append(buildSkyDome(n, lastData.latitude, lastData.longitude, lastData.timezone),
                el("p", "sky-cap", "Drag to watch the sky move through the night."));
    detailEl.append(block("The sky tonight", wrap));

    detailEl.append(block("What to observe, and when", buildObjectsFilter(n, hrs)));
  }
}

function render() {
  const data = lastData;
  if (!data) return;
  resultEl.hidden = false;

  placeNameEl.textContent = current.label;
  const lp = data.light_pollution;
  if (lp) {
    placeSkyEl.className = "place-sky";
    placeSkyEl.textContent = `${lp.description} · Bortle ${lp.bortle} · SQM ${lp.sqm}`;
  } else {
    placeSkyEl.className = "place-sky is-missing";
    placeSkyEl.textContent = "light pollution not applied — scores are optimistic in urban areas";
  }
  darkerCta.hidden = false;   // há um local: dá para procurar céu mais escuro por perto

  if (!selectedDate || !data.nights.some((n) => n.date === selectedDate)) {
    // Abre-se na noite MAIS PRÓXIMA — a pergunta é "vale a pena sair hoje?".
    // Se já há uma noite a decorrer, é essa; senão, a primeira que aí vem. A
    // melhor da semana fica assinalada na tira (is-best), mas não é a que abre.
    const live = data.nights.find((n) => n.in_progress);
    selectedDate = (live || data.nights[0]).date;
  }

  renderStrip(data);
  renderDetail(data.nights.find((n) => n.date === selectedDate));
}

/* ------------------------------------------------- autocomplete */

let suggestions = [];
let highlighted = -1;
let debounceTimer = null;
let lastQuery = "";

function closeSuggestions() {
  suggestionsEl.hidden = true;
  suggestionsEl.innerHTML = "";
  placeInput.setAttribute("aria-expanded", "false");
  suggestions = [];
  highlighted = -1;
}

function setHighlight(index) {
  const items = suggestionsEl.querySelectorAll("li");
  items.forEach((li, i) => li.classList.toggle("active", i === index));
  highlighted = index;
  if (index >= 0 && items[index]) items[index].scrollIntoView({ block: "nearest" });
}

function chooseSuggestion(index) {
  const r = suggestions[index];
  if (!r) return;
  rememberCountry(r.country_code);
  placeInput.value = placeLabel(r);
  closeSuggestions();
  current = { lat: r.latitude, lon: r.longitude, label: placeLabel(r) };
  loadForecast();
}

function renderSuggestions(results) {
  suggestions = results;
  highlighted = -1;
  suggestionsEl.innerHTML = "";
  if (!results.length) { closeSuggestions(); return; }
  results.forEach((r, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.append(el("span", "sug-name", r.name),
              el("span", "sug-sub", [r.admin1, r.country].filter(Boolean).join(" · ")),
              el("span", "sug-coords",
                 `${r.latitude.toFixed(3)}, ${r.longitude.toFixed(3)}`));
    // mousedown corre antes do blur do input, senão a lista fecha primeiro.
    li.addEventListener("mousedown", (e) => { e.preventDefault(); chooseSuggestion(i); });
    li.addEventListener("mouseenter", () => setHighlight(i));
    suggestionsEl.append(li);
  });
  suggestionsEl.hidden = false;
  placeInput.setAttribute("aria-expanded", "true");
}

placeInput.addEventListener("input", () => {
  const q = placeInput.value.trim();
  clearTimeout(debounceTimer);
  if (q.length < 2) { closeSuggestions(); return; }
  debounceTimer = setTimeout(async () => {
    lastQuery = q;
    try {
      const results = await geocodeMany(q);
      if (lastQuery === q) renderSuggestions(results);   // ignora respostas fora de ordem
    } catch { closeSuggestions(); }
  }, 250);
});

placeInput.addEventListener("keydown", (e) => {
  if (suggestionsEl.hidden) return;
  if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((highlighted + 1) % suggestions.length); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((highlighted - 1 + suggestions.length) % suggestions.length); }
  else if (e.key === "Enter" && highlighted >= 0) { e.preventDefault(); chooseSuggestion(highlighted); }
  else if (e.key === "Escape") closeSuggestions();
});

placeInput.addEventListener("blur", () => setTimeout(closeSuggestions, 120));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (highlighted >= 0) { chooseSuggestion(highlighted); return; }
  const name = placeInput.value.trim();
  if (!name) return;
  closeSuggestions();
  // Se o texto é o rótulo do local já escolhido, reutiliza-o — o rótulo completo
  // ("Fundão, Distrito…, PT") não é geocodificável, e re-procurar era o que dava
  // o "não encontrada". Assim "Ver noites" volta a correr o local escolhido.
  if (current && name === current.label) { loadForecast(); return; }
  setStatus("Finding the location…");
  try {
    current = await geocode(name);
    await loadForecast();
  } catch (err) {
    setStatus(`⚠️ ${err.message}`);
  }
});

geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) { setStatus("⚠️ Your browser doesn't support geolocation."); return; }
  setStatus("Getting your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      current = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: "your location" };
      loadForecast();
    },
    () => setStatus("⚠️ Couldn't get your location."),
  );
});

/* ------------------------------------------------- locais guardados */

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"); }
  catch { return []; }
}

function storeSaved(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* ignorar */ }
  renderSaved();
}

function renderSaved() {
  const list = loadSaved();
  savedListEl.innerHTML = "";
  for (const p of list) {
    const chip = el("span", "saved-chip");
    const go = el("button", "saved-go", p.name);
    go.type = "button";
    go.title = `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
    go.addEventListener("click", () => {
      current = { lat: p.lat, lon: p.lon, label: p.name };
      placeInput.value = p.name;
      loadForecast();
    });
    const del = el("button", "saved-del", "✕");
    del.type = "button";
    del.title = `Esquecer ${p.name}`;
    del.addEventListener("click", () => storeSaved(loadSaved().filter((x) => x.name !== p.name)));
    chip.append(go, del);
    savedListEl.append(chip);
  }
  compareBtn.hidden = list.length < 2;
}

saveBtn.addEventListener("click", () => {
  saveForm.hidden = false;
  saveName.value = current ? current.label : "";
  saveName.focus();
  saveName.select();
});
saveCancel.addEventListener("click", () => { saveForm.hidden = true; });
saveConfirm.addEventListener("click", () => {
  const name = saveName.value.trim();
  if (!name || !current) return;
  const list = loadSaved().filter((p) => p.name !== name);   // substitui homónimo
  list.push({ name, lat: current.lat, lon: current.lon });
  storeSaved(list);
  saveForm.hidden = true;
});
saveName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); saveConfirm.click(); }
  if (e.key === "Escape") saveForm.hidden = true;
});

/* ------------------------------------------------- comparar */

const compareClass = (s) => (s >= 55 ? "cmp-good" : s >= 35 ? "cmp-ok" : "cmp-poor");

async function openCompare() {
  const places = loadSaved();
  if (places.length < 2) return;
  compareModal.hidden = false;
  compareBody.innerHTML = "<p class='status'>Calculating…</p>";

  const results = await Promise.all(places.map(async (p) => {
    try {
      return { place: p, data: await computeForecast(p.lat, p.lon, mode) };
    } catch { return { place: p, error: true }; }
  }));

  const ok = results.filter((r) => !r.error);
  if (!ok.length) {
    compareBody.innerHTML = "<p class='status'>Couldn't calculate.</p>";
    return;
  }

  let best = { score: -1 };
  for (const r of ok) {
    for (const n of r.data.nights) {
      if (n.score > best.score) best = { score: n.score, place: r.place.name, night: n };
    }
  }

  const table = el("table", "cmp-table");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.append(document.createElement("th"));
  for (const n of ok[0].data.nights) {
    const dt = new Date(n.date + "T12:00:00");
    hr.append(el("th", null, dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })));
  }
  thead.append(hr);

  const tbody = document.createElement("tbody");
  for (const r of ok) {
    const tr = document.createElement("tr");
    const th = el("th", "cmp-place");
    th.append(document.createTextNode(r.place.name),
              el("span", null, r.data.light_pollution
                ? r.data.light_pollution.description : "light pollution unknown"));
    tr.append(th);
    for (const n of r.data.nights) {
      const td = el("td", compareClass(n.score), String(n.score));
      if (r.place.name === best.place && n.date === best.night.date) td.classList.add("cmp-best");
      td.title = n.details;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);

  const verdict = el("p", "cmp-verdict");
  verdict.append(document.createTextNode("Best combination: "));
  verdict.append(el("strong", null, `${best.place}, ${weekdayLong(best.night.date)}`));
  verdict.append(document.createTextNode(`: ${best.night.headline.toLowerCase()}, score ${best.score}.`));

  compareBody.innerHTML = "";
  compareBody.append(verdict, table);
}

compareBtn.addEventListener("click", openCompare);
compareClose.addEventListener("click", () => { compareModal.hidden = true; });
compareModal.addEventListener("click", (e) => {
  if (e.target === compareModal) compareModal.hidden = true;
});

/* ------------------------------------------------- mapa */

let map = null, marker = null, picked = null, darkerLayer = null;

function initMap() {
  // O Leaflet só mede bem o contentor depois de visível.
  map = L.map("map").setView(current ? [current.lat, current.lon] : [39.6, -8.0],
                             current ? 10 : 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // A "cunha" do Astrowe: camada de poluição luminosa por cima do mapa, para
  // se ver ONDE está escuro antes de escolher o sítio. Tiles do Atlas de David
  // Lorenz (VIIRS 2024) — o mesmo dataset livre que a comunidade usa. tileSize
  // 1024 + zoomOffset −2 são o esquema próprio dele (não mexer).
  const lightPollution = L.tileLayer(
    "https://djlorenz.github.io/astronomy/image_tiles/tiles2024/tile_{z}_{x}_{y}.png", {
      minZoom: 2, maxNativeZoom: 8, maxZoom: 19, tileSize: 1024, zoomOffset: -2,
      opacity: 0.55,
      errorTileUrl: "https://djlorenz.github.io/astronomy/image_tiles/tiles2024/black.png",
      attribution: 'Light pollution &copy; <a href="https://djlorenz.github.io/astronomy/lp/" '
        + 'target="_blank" rel="noopener">D. Lorenz</a>',
    }).addTo(map);

  // Toggle da camada — fica ligada por defeito (é o que interessa mostrar).
  L.control.layers(null, { "Light pollution": lightPollution },
                   { collapsed: false }).addTo(map);
  addMapLegend();
  darkerLayer = L.layerGroup().addTo(map);   // marcadores das sugestões

  map.on("click", (e) => selectMapPoint(e.latlng.lat, e.latlng.lng));
}

/** Escolhe um ponto no mapa: marcador, coordenadas, botão e leitura do Bortle.
 *  Se `lpText` vier dado (sugestão já traz o Bortle), evita novo pedido. */
function selectMapPoint(lat, lon, lpText, lpClass) {
  picked = { lat, lon };
  if (marker) marker.setLatLng([lat, lon]);
  else marker = L.marker([lat, lon]).addTo(map);
  mapCoords.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  mapConfirm.disabled = false;
  if (lpText) { mapLp.textContent = lpText; mapLp.className = lpClass; }
  else showPointDarkness(lat, lon);
}

/** Bortle 1–3 escuro, 4–5 razoável, 6+ poluído — cor pela mesma paleta do site. */
function bortleClass(bortle) {
  if (bortle <= 3) return "good";
  if (bortle <= 5) return "ok";
  return "poor";
}

// Cada clique pede a poluição luminosa do ponto; a sequência ignora respostas
// obsoletas se clicares depressa noutro sítio.
let lpRequestSeq = 0;
async function showPointDarkness(lat, lon) {
  const seq = ++lpRequestSeq;
  mapLp.textContent = "checking sky darkness…";
  mapLp.className = "map-lp is-loading";
  try {
    const r = await fetch(`/api/lightpollution?lat=${lat}&lon=${lon}`);
    if (seq !== lpRequestSeq) return;   // já clicaste noutro ponto
    const lp = r.ok ? (await r.json()).light_pollution : null;
    if (lp) {
      mapLp.textContent = `Bortle ${lp.bortle} · ${lp.description} · SQM ${lp.sqm}`;
      mapLp.className = `map-lp is-${bortleClass(lp.bortle)}`;
    } else {
      mapLp.textContent = "sky darkness unavailable here";
      mapLp.className = "map-lp is-missing";
    }
  } catch {
    if (seq !== lpRequestSeq) return;
    mapLp.textContent = "sky darkness unavailable";
    mapLp.className = "map-lp is-missing";
  }
}

const DARKER_RADIUS_KM = 40;

/** A "cunha": sugerir sítios mais escuros por perto. Parte do ponto escolhido
 *  (ou da localização atual, ou do centro do mapa) e pede ao backend. */
async function findDarkerNearby() {
  const c = map && map.getCenter();
  const origin = picked
    || (current ? { lat: current.lat, lon: current.lon } : null)
    || (c ? { lat: c.lat, lon: c.lng } : null);
  if (!origin) return;

  darkerBtn.disabled = true;
  darkerStatus.textContent = "Scanning nearby skies…";
  darkerList.hidden = true;
  darkerList.innerHTML = "";
  if (darkerLayer) darkerLayer.clearLayers();
  try {
    const r = await fetch(`/api/darker-nearby?lat=${origin.lat}&lon=${origin.lon}`
                          + `&radius_km=${DARKER_RADIUS_KM}`);
    const data = r.ok ? await r.json() : null;
    const suggestions = data ? data.suggestions : [];
    if (!suggestions.length) {
      darkerStatus.textContent = data && data.origin
        ? `This is about the darkest sky within ${DARKER_RADIUS_KM} km — nothing clearly better nearby.`
        : "Sky darkness data isn't available here.";
      return;
    }
    darkerStatus.textContent = "Darker skies nearby — closer & a bit darker, "
      + "or farther & darkest. Tap one:";
    for (const s of suggestions) renderDarkerItem(s);
    darkerList.hidden = false;
  } catch {
    darkerStatus.textContent = "Couldn't check nearby skies. Try again.";
  } finally {
    darkerBtn.disabled = false;
  }
}

function renderDarkerItem(s) {
  const li = el("li", `darker-item is-${bortleClass(s.bortle)}`);
  const info = el("div", "darker-info");
  info.append(el("span", "darker-bortle", `Bortle ${s.bortle}`),
              el("span", "darker-desc", ` · ${s.description}`));
  if (s.bortle_gain > 0) info.append(el("span", "darker-gain", `−${s.bortle_gain}`));
  li.append(info, el("div", "darker-meta",
                     `${s.distance_km} km ${s.direction} · SQM ${s.sqm}`));
  li.addEventListener("click", () => {
    selectMapPoint(s.lat, s.lon, `Bortle ${s.bortle} · ${s.description} · SQM ${s.sqm}`,
                   `map-lp is-${bortleClass(s.bortle)}`);
    if (map) map.setView([s.lat, s.lon], 9);
  });
  if (darkerLayer) {
    L.circleMarker([s.lat, s.lon], {
      radius: 8, color: "#8bae7f", weight: 2, fillColor: "#8bae7f", fillOpacity: 0.5,
    }).addTo(darkerLayer).bindTooltip(`Bortle ${s.bortle} · ${s.distance_km} km ${s.direction}`);
  }
  darkerList.append(li);
}

/** Legenda da camada: um gradiente do céu escuro ao brilho da cidade. */
function addMapLegend() {
  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "lp-legend");
    div.innerHTML =
      '<span class="lp-legend-title">Light pollution</span>'
      + '<span class="lp-legend-bar" aria-hidden="true"></span>'
      + '<span class="lp-legend-ends"><span>darker sky</span><span>city glow</span></span>';
    return div;
  };
  legend.addTo(map);
}

function openMap() {
  mapModal.hidden = false;
  mapLp.textContent = "";           // limpa o Bortle do ponto anterior
  mapLp.className = "map-lp";
  darkerStatus.textContent = "";    // limpa sugestões da vez anterior
  darkerList.hidden = true;
  darkerList.innerHTML = "";
  if (!map) initMap();
  if (darkerLayer) darkerLayer.clearLayers();
  setTimeout(() => map.invalidateSize(), 50);
  if (current) map.setView([current.lat, current.lon], 10);
}
mapBtn.addEventListener("click", openMap);
darkerBtn.addEventListener("click", findDarkerNearby);
// CTA na previsão: abre o mapa e já corre a pesquisa a partir do local atual.
darkerCta.addEventListener("click", () => { openMap(); findDarkerNearby(); });
mapClose.addEventListener("click", () => { mapModal.hidden = true; });
mapModal.addEventListener("click", (e) => { if (e.target === mapModal) mapModal.hidden = true; });
mapConfirm.addEventListener("click", () => {
  if (!picked) return;
  current = { lat: picked.lat, lon: picked.lon,
              label: `${picked.lat.toFixed(4)}, ${picked.lon.toFixed(4)}` };
  placeInput.value = current.label;
  mapModal.hidden = true;
  loadForecast();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!mapModal.hidden) mapModal.hidden = true;
  if (!compareModal.hidden) compareModal.hidden = true;
  const pm = $("page-modal");
  if (pm && !pm.hidden) pm.hidden = true;
  closeMenu();
});

/* ------------------------------------------------- modos */

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.mode === mode) return;
    mode = btn.dataset.mode;
    modeBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    loadForecast(true);        // mantém a noite escolhida ao trocar de modo
  });
});

renderSaved();

/* ------------------------------------------------- modo vermelho (visão nocturna)
   O vermelho preserva a adaptação ao escuro dos olhos — é o que se usa no
   terreno. Recolore o site inteiro e fica guardado entre visitas. */

const RED_KEY = "astrowe.redmode";
const redBtn = $("red-btn");

function applyRedMode(on) {
  document.documentElement.classList.toggle("red", on);
  redBtn.setAttribute("aria-pressed", on ? "true" : "false");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", on ? "#070000" : "#060607");
}

redBtn.addEventListener("click", () => {
  const on = !document.documentElement.classList.contains("red");
  applyRedMode(on);
  try { localStorage.setItem(RED_KEY, on ? "1" : "0"); } catch { /* ignorar */ }
});

try { applyRedMode(localStorage.getItem(RED_KEY) === "1"); } catch { /* ignorar */ }

/* ------------------------------------------------- menu, páginas e cookies */

// Conteúdo das páginas. As "a preencher" ficam para depois; algumas já vão
// completas. Os textos legais (cookies/privacidade/termos) tens de ser TU a
// escrevê-los — deixo o esqueleto.
const PAGES = {
  howto: { title: "How to use", html:
    `<p>Astrowe answers one question: <strong>of the next few nights, which is
        worth it?</strong> In three steps:</p>
     <h3>1. Choose where and what</h3>
     <p>Type a location (or use 📍 for yours, or 🗺 to pick on the map). Then choose the
        observing type: <strong>Deep sky</strong> (galaxies, nebulae — needs darkness)
        or <strong>Planets & Moon</strong> (just needs the Sun down; seeing is what
        matters).</p>
     <h3>2. Read the strip of nights</h3>
     <p>Each night has a score from 0 to 100 and the Moon phase. The best one is
        highlighted. Click a night for the detail. After midnight, the night in progress
        shows as <strong>Now</strong>, with only the hours left.</p>
     <h3>3. Read the detail</h3>
     <ul>
       <li><strong>Verdict</strong> — the answer in a sentence, plus "what lowers the score".</li>
       <li><strong>Band</strong> — the night at a glance: the best window highlighted and
           when the Moon sets.</li>
       <li><strong>Conditions</strong> — clouds, dew, temperature, Moon, hour by hour.</li>
       <li><strong>The dome</strong> — the sky seen from below; drag the slider to watch
           it move through the night.</li>
       <li><strong>What to observe</strong> — the targets, when they're at their best,
           colour-coded by how high they are (green/amber/faded).</li>
     </ul>
     <p>You can <strong>save places</strong> and <strong>compare them</strong> night by
        night. And <strong>night-vision mode</strong> recolours the site red so it doesn't
        spoil your dark adaptation in the field.</p>` },
  faq: { title: "FAQ", html:
    `<p class="faq-hint">Tap a question to see the answer.</p>
     <details><summary>What is the score and how is it calculated?</summary>
       <p>A number from 0 to 100 per night. It combines, hour by hour, cloud by layer, the
          Moon's phase and altitude, transparency (how dry the air is), seeing (high
          turbulence) and the site's light pollution. It doesn't average the night — it
          finds the best contiguous window of hours. The raw numbers live in the
          "Full table".</p>
     </details>
     <details><summary>Why does the same night score differently in "Deep sky" and "Planets & Moon"?</summary>
       <p>They use different weights and windows. Deep sky needs astronomical darkness and
          the Moon penalises heavily. Planets show up in twilight and the Moon barely
          counts — there, seeing is what decides.</p>
     </details>
     <details><summary>What is the best window?</summary>
       <p>The stretch of hours with the best contiguous quality — the best time to observe
          that night. It's highlighted in the band and in the hours.</p>
     </details>
     <details><summary>Why does a night's score change from one day to the next?</summary>
       <p>The weather forecast updates. The same night, seen further ahead, is less
          reliable.</p>
     </details>
     <details><summary>Do I need a telescope?</summary>
       <p>Not necessarily. The score is about sky conditions — it works for the naked eye,
          binoculars or a telescope. The Moon, the planets and meteor showers are all
          visible with no equipment.</p>
     </details>
     <details><summary>What do the object colours mean?</summary>
       <p>Green = at its best (above 50° altitude), amber = usable (30–50°), faded = too
          low (below 30°). The higher it is, the less atmosphere you look through.</p>
     </details>
     <details><summary>An object is up but has no bar in "What to observe". Why?</summary>
       <p>The bars only start at 30° altitude — below that it's not worth pointing a
          telescope. On the dome you see the object even when it's low; in the bars, only
          once it climbs.</p>
     </details>
     <details><summary>Where does the data come from?</summary>
       <p>Weather from <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>;
          Sun, Moon and planets computed with <a href="https://rhodesmill.org/skyfield/" target="_blank" rel="noopener">Skyfield</a>;
          light pollution from <a href="https://www.lightpollutionmap.info" target="_blank" rel="noopener">lightpollutionmap.info</a>;
          map from OpenStreetMap. See the <button type="button" class="link-btn" data-page="ack">Acknowledgements</button>.</p>
     </details>
     <details><summary>How many nights does it show, and how reliable are they?</summary>
       <p>The next ~7 nights. Like any forecast, the first ones are more reliable; beyond
          4–5 days it's indicative.</p>
     </details>
     <details><summary>Why does light pollution sometimes not appear?</summary>
       <p>That factor needs a personal API key. Without it the site still works, just
          without that factor — and it warns you, because the scores get optimistic in
          urban areas.</p>
     </details>
     <details><summary>Why is the first visit of the day slow to load?</summary>
       <p>The site runs on a free tier that sleeps after 15 minutes of no use. The first
          visit can take ~30–50 s to wake up; after that it's fast.</p>
     </details>
     <details><summary>Where are my saved places kept?</summary>
       <p>In your own browser (local storage), not on our server. They're private and you
          can delete them whenever you want.</p>
     </details>
     <details><summary>What is night-vision mode for?</summary>
       <p>It recolours the site in shades of red so it doesn't spoil your eyes' dark
          adaptation — the light you use in the field so you don't "blind" yourself between
          observations.</p>
     </details>` },
  links: { title: "Useful links", html:
    `<p>Resources that help you plan and get more out of your nights:</p>
     <ul>
       <li><a href="https://astronomy.tools/" target="_blank" rel="noopener">astronomy.tools</a>
           — field-of-view calculators, eyepiece and telescope comparators</li>
       <li><a href="https://telescopius.com/" target="_blank" rel="noopener">Telescopius</a>
           — object pages, sky maps and session planning</li>
     </ul>` },
  contact: { title: "Contact", html:
    `<p>For questions, suggestions or to report a problem, write to
        <a href="mailto:astrowe.info@gmail.com">astrowe.info@gmail.com</a>.</p>` },
  bugs: { title: "Report a bug", html:
    `<p>Found a bug or have an idea?</p>
     <p><a href="https://github.com/loladaki/Astrowe/issues" target="_blank" rel="noopener">Open an issue on GitHub</a>, or use the <button type="button" class="link-btn" data-page="contact">contact page</button>.</p>` },
  status: { title: "Service status", html:
    `<p>Current status: <strong id="status-live">checking…</strong></p>
     <p class="footer-muted">The site runs on Render (free tier): the first visit of the
        day can take ~30–50 s to wake up.</p>` },
  ack: { title: "Acknowledgements", html:
    `<p>Astrowe is built on open data and tools:</p>
     <ul>
       <li><a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> — weather</li>
       <li><a href="https://rhodesmill.org/skyfield/" target="_blank" rel="noopener">Skyfield</a> — ephemerides (Sun, Moon, planets)</li>
       <li><a href="https://www.lightpollutionmap.info" target="_blank" rel="noopener">lightpollutionmap.info</a> — light pollution (score)</li>
       <li><a href="https://djlorenz.github.io/astronomy/lp/" target="_blank" rel="noopener">David J. Lorenz's Light Pollution Atlas</a> — light pollution map layer</li>
       <li><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> + <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a> — map</li>
       <li>Messier catalogue validated against SIMBAD</li>
     </ul>
     <p class="footer-muted">Please respect each source's terms.</p>` },
  cookies: { title: "Cookie policy", html:
    `<p class="footer-muted"><em>Draft — review and adapt before publishing. Not legal advice.</em></p>
     <h3>What we use today</h3>
     <p>Astrowe uses your browser's <strong>local storage</strong> (not cookies sent to
        servers) to keep your preferences: night-vision mode, preferred country, the
        places you save, and your consent choice. These are essential to how the site
        works and stay only on your device.</p>
     <h3>Third-party cookies (advertising)</h3>
     <p>When advertising is enabled, <strong>Google AdSense</strong> may use cookies to
        show and measure ads. They are only loaded <strong>after you accept</strong> in
        the consent banner. If you choose "Essential only", they aren't used.</p>
     <h3>How to control it</h3>
     <p>You can decline the non-essential ones in the banner, clear the storage in your
        browser settings, and manage your ad options at
        <a href="https://myadcenter.google.com" target="_blank" rel="noopener">myadcenter.google.com</a>.</p>
     <p class="footer-muted">Last updated: 26/07/2026.</p>` },
  privacy: { title: "Privacy policy", html:
    `<p class="footer-muted"><em>Draft — review and adapt before publishing. Not legal advice.</em></p>
     <h3>Who is responsible</h3>
     <p>Data controller: <strong>José Bento</strong> (as an individual), reachable at
        <a href="mailto:astrowe.info@gmail.com">astrowe.info@gmail.com</a>.</p>
     <h3>What data we process</h3>
     <p>No sign-up or account is needed. The <strong>location</strong> you choose is used
        to compute the forecast — it's sent to Open-Meteo (weather) and to our server,
        which does the astronomical calculations and returns the result. We don't link
        that location to your identity, nor keep a history of you. The <strong>places you
        save</strong> and your <strong>preferences</strong> stay only in your browser
        (local storage), not on our servers.</p>
     <h3>Third parties</h3>
     <ul>
       <li><a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> — weather</li>
       <li><a href="https://www.lightpollutionmap.info" target="_blank" rel="noopener">lightpollutionmap.info</a> — light pollution</li>
       <li>OpenStreetMap — map</li>
       <li>Render — site hosting</li>
       <li>Google AdSense — advertising (when enabled, only after consent)</li>
     </ul>
     <h3>Your rights</h3>
     <p>Under the GDPR you have the right of access, rectification, erasure and objection.
        As we don't keep personal data linked to you, deleting your preferences and saved
        places is done by clearing your browser storage. For any question, contact
        <a href="mailto:astrowe.info@gmail.com">astrowe.info@gmail.com</a>.</p>
     <p class="footer-muted">Last updated: 26/07/2026.</p>` },
  terms: { title: "Terms & conditions", html:
    `<p class="footer-muted"><em>Draft — review and adapt before publishing. Not legal advice.</em></p>
     <h3>Use of the service</h3>
     <p>Astrowe is a tool to support astronomical observation, provided free and
        <strong>"as is"</strong>. Forecasts are estimates based on weather models and
        astronomical calculations — they can be wrong. Any decisions you make (going out,
        travelling, setting up gear) are your responsibility.</p>
     <h3>No warranty</h3>
     <p>We don't guarantee accuracy, continuous availability or fitness for any particular
        purpose. We're not liable for any loss or damage arising from use (or inability to
        use) the site.</p>
     <h3>Third-party content</h3>
     <p>Weather, light-pollution and map data belong to their respective sources and are
        governed by their terms. External links are the responsibility of the destination
        sites.</p>
     <h3>Changes and governing law</h3>
     <p>We may change these terms at any time. The law of Portugal applies.</p>
     <p class="footer-muted">Last updated: 26/07/2026.</p>` },
};

const menuBtn = $("menu-btn"), menuPanel = $("menu-panel");
const pageModal = $("page-modal"), pageTitle = $("page-title"), pageBody = $("page-body");

function closeMenu() {
  if (!menuPanel) return;
  menuPanel.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
}

async function checkStatus() {
  const el = $("status-live");
  if (!el) return;
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    el.textContent = r.ok ? "operational ✓" : "having problems";
    el.className = r.ok ? "status-ok" : "status-bad";
  } catch {
    el.textContent = "unreachable"; el.className = "status-bad";
  }
}

function openPage(key) {
  closeMenu();
  if (key === "home") { pageModal.hidden = true; return; }
  const p = PAGES[key];
  if (!p) return;
  pageTitle.textContent = p.title;
  pageBody.innerHTML = p.html;
  pageModal.hidden = false;
  pageBody.scrollTop = 0;
  if (key === "status") checkStatus();
}

// Delegação: apanha todos os botões [data-page] — do menu, do footer, do banner
// e os que aparecem dentro das próprias páginas.
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-page]");
  if (t) { e.preventDefault(); openPage(t.dataset.page); }
});

if (menuBtn && menuPanel) {
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menuPanel.hidden;
    menuPanel.hidden = !willOpen;
    menuBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });
  document.addEventListener("click", (e) => {
    if (!menuPanel.hidden && !menuPanel.contains(e.target) && e.target !== menuBtn) closeMenu();
  });
}

if (pageModal) {
  $("page-close").addEventListener("click", () => { pageModal.hidden = true; });
  pageModal.addEventListener("click", (e) => { if (e.target === pageModal) pageModal.hidden = true; });
}

/* Consentimento de cookies: guarda a escolha; é aqui que, no futuro, se decide
   carregar (ou não) os anúncios/analítica. */
const CONSENT_KEY = "astrowe.consent";
const cookieBanner = $("cookie-banner");
function setConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* ignorar */ }
  if (cookieBanner) cookieBanner.hidden = true;
  // No futuro: if (value === "all") carregar anúncios/analítica.
}
if (cookieBanner) {
  $("cookie-accept").addEventListener("click", () => setConsent("all"));
  $("cookie-reject").addEventListener("click", () => setConsent("essential"));
  try {
    if (!localStorage.getItem(CONSENT_KEY)) cookieBanner.hidden = false;
  } catch { /* sem localStorage: não mostrar */ }
}
