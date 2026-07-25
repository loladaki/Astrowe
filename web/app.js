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
      `${Math.round(cur.alt)}° acima do horizonte, a ${skyCompass(cur.az)}`));
    const am = skyAirmass(cur.alt);
    if (am !== null) pop.append(el("div", "sky-pop-line", `airmass ${am.toFixed(1)}`));
    if (o.transit_time) {
      pop.append(el("div", "sky-pop-line",
        `mais alto às ${hhmm(o.transit_time)} (${Math.round(o.max_altitude_deg)}°)`));
    }
    if (o.washed_out) pop.append(el("div", "sky-pop-warn", "apagado pelo luar"));
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

    // estrelas reais de fundo (só as acima do horizonte)
    for (const [raH, decDeg, mag, name] of BRIGHT_STARS) {
      const [alt, az] = altAz(raH, decDeg, lst, lat);
      if (alt <= 0) continue;
      const [x, y] = pos(alt, az);
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
      const isMoon = o.kind === "satélite", isPlanet = o.kind === "planeta";
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

  // legenda das cores dos alvos — igual à de "O que observar"
  const legend = el("div", "sky-legend");
  const swatch = (color, txt) => {
    const s = el("span", "sky-leg");
    const d = el("span", "sky-leg-dot"); d.style.background = color;
    s.append(d, document.createTextNode(txt));
    return s;
  };
  legend.append(swatch("var(--good)", "no melhor (>50°)"),
                swatch("var(--ok)", "utilizável (30–50°)"),
                swatch("var(--faint)", "baixo (<30°)"));

  // ---- slider de tempo ----
  // Varre a MESMA janela horária das barras de "O que observar" e do meteograma
  // (do início ao fim da noite mostrada), para os três baterem certo. Antes ia
  // só até ao fim da escuridão astronómica e parecia curto ao lado das barras,
  // que seguem os objectos pelo crepúsculo adentro.
  const wall = (iso) => localWallToUTC(iso, tz).getTime();
  const hrsArr = n.hours || [];
  const t0 = wall(hrsArr.length ? hrsArr[0].time : (n.night_start || n.window_start));
  const t1 = wall(hrsArr.length ? hrsArr[hrsArr.length - 1].time : (n.night_end || n.window_end));
  const tMid = (wall(n.window_start) + wall(n.window_end)) / 2;

  // Sem noite válida (caso raro): desenha só o instante médio, sem slider.
  if (!isFinite(t0) || !isFinite(t1) || t1 <= t0) {
    draw(new Date(isFinite(tMid) ? tMid : t0));
    wrap.append(legend);
    return wrap;
  }

  const control = el("div", "sky-time");
  const label = el("div", "sky-time-lbl");
  const fmt = new Intl.DateTimeFormat("pt-PT",
    { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const slider = el("input", "sky-slider");
  slider.type = "range";
  slider.min = String(Math.round(t0));
  slider.max = String(Math.round(t1));
  slider.step = String(5 * 60 * 1000);   // passos de 5 minutos
  slider.value = String(Math.round(Math.min(Math.max(tMid, t0), t1)));
  slider.setAttribute("aria-label", "Hora da noite");

  // Marca no fundo do slider a escuridão astronómica (dusk→dawn): fora dela, nas
  // pontas, o Sol ainda clareia o céu (crepúsculo). É a resposta visual ao
  // "porque é que as barras vão mais longe que o slider?": vão para o crepúsculo.
  let darkHint = "";
  if (n.dusk && n.dawn) {
    const span = t1 - t0;
    const p0 = Math.max(0, Math.min(100, (wall(n.dusk) - t0) / span * 100));
    const p1 = Math.max(0, Math.min(100, (wall(n.dawn) - t0) / span * 100));
    if (p1 - p0 > 1 && (p0 > 1 || p1 < 99)) {
      slider.style.background =
        `linear-gradient(90deg, var(--border-lit) ${p0.toFixed(1)}%,` +
        ` rgba(224,152,94,0.45) ${p0.toFixed(1)}%, rgba(224,152,94,0.45) ${p1.toFixed(1)}%,` +
        ` var(--border-lit) ${p1.toFixed(1)}%)`;
      darkHint = `céu totalmente escuro das ${fmt.format(new Date(wall(n.dusk)))}`
               + ` às ${fmt.format(new Date(wall(n.dawn)))} · fora daí, crepúsculo`;
    }
  }

  const update = () => {
    const d = new Date(Number(slider.value));
    label.textContent = fmt.format(d);
    draw(d);
  };
  slider.addEventListener("input", update);
  control.append(label, slider);
  if (darkHint) control.append(el("div", "sky-time-hint", darkHint));
  wrap.append(control);

  update();   // primeira pintura, à hora recomendada
  wrap.append(legend);
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
  let url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=${count}&language=pt&format=json`;
  if (countryCode) url += `&countryCode=${countryCode}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Falha na geocodificação");
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
  const results = await geocodeMany(name, 1);
  if (!results.length) throw new Error(`Localidade "${name}" não encontrada`);
  const r = results[0];
  rememberCountry(r.country_code);
  return { lat: r.latitude, lon: r.longitude, label: placeLabel(r) };
}

/* ------------------------------------------------- dados */

async function loadForecast(keepDate) {
  if (!current) return;
  setStatus(`A calcular as noites para ${current.label}…`);
  resultEl.hidden = true;
  // O plano gratuito do Render adormece; a primeira resposta do dia demora a
  // acordar. Avisar em vez de deixar a pessoa achar que travou.
  const waking = setTimeout(
    () => setStatus("A acordar o servidor… a primeira vez do dia pode levar até 1 min."),
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

const weekdayShort = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "");
const weekdayLong = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "short" });

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
    box.append(el("div", "limits-none", "Nada a limitar, condições no máximo."));
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
    box.append(el("div", "limit-group", "Este sítio"));
    const row = el("div", "limit");
    row.append(el("span", "limit-name", `poluição luminosa · Bortle ${lp.bortle}`));
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
    box.append(el("div", "limit-group", "Esta noite"));
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
    tag: "Lua",
    value: c ? c.moon_label : n.moon_phase,
    spark: el("div", "cond-note", `${Math.round(n.moon_illumination_pct)}% iluminada`),
  }));

  grid.append(condItem({
    icon: iconSVG("cloud"), tag: "nuvens",
    value: c ? c.clouds_label : "—",
    spark: c ? scaledSpark(c.clouds_spark, "%", true, 25) : null,
  }));

  const dewWarn = c && /Prov|Poss/.test(c.dew_label);
  grid.append(condItem({
    icon: iconSVG("droplet", 20, dewWarn ? "icon warn" : "icon"), tag: "orvalho",
    value: c ? c.dew_label : "—",
    spark: c ? scaledSpark(c.dew_spark, "°", false, 3) : null,
  }));

  grid.append(condItem({
    icon: iconSVG("thermo"), tag: "temperatura",
    value: c ? c.temp_label : "—",
    spark: el("div", "cond-note",
      [n.wind_kmh !== null ? `vento ${Math.round(n.wind_kmh)} km/h` : "",
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
  box.append(meteoRow("nuvens", hours, "cloud", (v) => v === null ? "—" : `${Math.round(v)}%`));
  box.append(meteoRow("seeing", hours, "jet",
    (v) => v === null ? "—" : v < 60 ? "bom" : v < 100 ? "médio" : "fraco"));
  box.append(meteoRow("Lua", hours, "moon",
    (v) => v === null ? "—" : v <= 0 ? "posta" : `${Math.round(v)}°`));
  box.append(meteoRow("margem orvalho", hours, "spread", (v) => v === null ? "—" : `${v.toFixed(1)}°`));
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
    ? `mais alto às ${hhmm(o.transit_time)} (${Math.round(o.max_altitude_deg)}°)`
    : `${o.trend}, até ${Math.round(o.max_altitude_deg)}°`;
  const bits = [o.kind];
  if (o.magnitude !== null) bits.push(`mag ${o.magnitude}`);
  bits.push(quando);
  if (o.airmass !== null) bits.push(`airmass ${o.airmass.toFixed(1)}`);
  if (o.washed_out) bits.push("apagado pelo luar");
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
  ["Tudo", null],
  ["Galáxias", ["galaxy"]],
  ["Nebulosas", ["nebula", "planetary"]],
  ["Enxames", ["open_cluster", "globular"]],
  ["Planetas", ["planet", "moon", "double"]],
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
  legend.append(mk("var(--good)", "no melhor (>50°)"), mk("var(--ok)", "utilizável (30–50°)"),
                mk("var(--border)", "baixo (<30°)"));

  let active = null;    // conjunto de símbolos, ou null = tudo
  let expanded = false;

  function draw() {
    rows.innerHTML = "";
    rows.append(timeHeader(hours));
    const matches = n.objects.filter((o) => !active || active.includes(o.symbol));
    const visible = expanded ? matches : matches.slice(0, TOP_OBJECTS);
    for (const o of visible) rows.append(objectItem(o, hours));

    if (!matches.length) {
      rows.append(el("div", "obj-empty", "Nenhum deste tipo acima do horizonte."));
    } else if (matches.length > TOP_OBJECTS && !expanded) {
      const more = el("button", "more", `ver os outros ${matches.length - TOP_OBJECTS}`);
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
    if (c < 15) { label = "céu limpo"; cls = "pill-good"; }
    else if (c < 40) { label = "poucas nuvens"; cls = "pill-ok"; }
    else { label = "muitas nuvens"; cls = "pill-poor"; }
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
  const track = el("div", "band-track");
  const duskP = pct(n.dusk) ?? 15, dawnP = pct(n.dawn) ?? 85;
  track.style.background =
    `linear-gradient(90deg, #3a2612 0%, #0a0908 ${duskP.toFixed(0)}%, ` +
    `#0a0908 ${dawnP.toFixed(0)}%, #3a2612 100%)`;

  // Lua no céu: fita fina no topo, de quando nasce (ou do início) até se pôr.
  if (n.moonset || n.moonrise) {
    const up = el("div", "band-moon");
    const a = pct(n.moonrise) ?? 0, b = pct(n.moonset) ?? 100;
    up.style.left = Math.min(a, b) + "%";
    up.style.width = Math.max(2, Math.abs(b - a)) + "%";
    track.append(up);
  }

  // Janela recomendada em destaque.
  const wa = pct(n.window_start), wb = pct(n.window_end);
  if (wa !== null && wb !== null) {
    const win = el("div", "band-window");
    win.style.left = wa + "%"; win.style.width = Math.max(2, wb - wa) + "%";
    track.append(win);
  }
  box.append(track);

  const labels = el("div", "band-labels");
  labels.append(el("span", null, `☼ ${hhmm(n.sun_set)}`),
                el("span", "band-mid", n.moonset ? `☾ põe-se ${hhmm(n.moonset)}` : ""),
                el("span", null, `☼ ${hhmm(n.sun_rise)}`));
  box.append(labels);
  return box;
}

/** Faixa fina de destaques da noite, logo abaixo do veredicto — em vez de uma
 *  caixa perdida no fim. Só aparece quando há algo a assinalar. */
function buildHighlights(n) {
  if (!n.meteor_shower && !n.milky_way) return null;
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
      `${m.summary} Radiante a ${Math.round(m.radiant_altitude_deg)}° ${m.radiant_direction}.`);
  }
  if (n.milky_way) {
    const g = n.milky_way;
    add("🌌", "Via Láctea",
      `${g.summary}${g.transit_time ? ` Mais alto às ${hhmm(g.transit_time)}.` : ""}`);
  }
  return box;
}

const RAW_COLUMNS = [
  ["Hora", (h) => hhmm(h.time)],
  ["Qual.", (h) => `${(h.quality * 100).toFixed(0)}%`],
  ["B/M/A", (h) => `${num(h.cloud_low_pct)}/${num(h.cloud_mid_pct)}/${num(h.cloud_high_pct)}`],
  ["Total", (h) => `${num(h.cloud_total_pct)}%`],
  ["Temp", (h) => `${num(h.temperature_c, 1)}°`],
  ["Orvalho", (h) => `${num(h.dew_point_c, 1)}°`],
  ["Spread", (h) => `${num(h.dew_spread_c, 1)}°`],
  ["HR", (h) => `${num(h.humidity_pct)}%`],
  ["Vento", (h) => num(h.wind_speed_kmh)],
  ["Rajada", (h) => num(h.wind_gusts_kmh)],
  ["Jet", (h) => num(h.jet_stream_kmh)],
  ["Visib.", (h) => (h.visibility_m == null ? "—" : `${(h.visibility_m / 1000).toFixed(0)}km`)],
  ["Lua alt", (h) => `${num(h.moon_altitude_deg)}°`],
  ["Lua %", (h) => num(h.moon_illumination_pct)],
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
    // A melhor noite fica sempre destacada; a seleccionada leva a moldura de
    // acento por cima. Coincidem por defeito, divergem quando clicas noutra.
    const b = el("button", `night-btn ${stripClass(n.score, usable)}` +
                           (n.date === bestDate ? " is-best" : "") +
                           (n.date === selectedDate ? " is-selected" : ""));
    b.type = "button";
    const dt = new Date(n.date + "T12:00:00");
    b.append(el("span", "d", `${weekdayShort(n.date)} ${dt.getDate()}`),
             el("span", "n", usable ? String(n.score) : "—"),
             moonSVG(n.moon_illumination_pct, n.moon_waxing, 20));
    b.title = `${weekdayLong(n.date)}: ${n.headline}`;
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
  const reason = n.verdict_reason || n.conditions;
  body.append(el("div", "verdict-sub", usable
    ? `${weekdayLong(n.date)} · ${hhmm(n.window_start)}–${hhmm(n.window_end)} · ${reason}`
    : `${weekdayLong(n.date)} · ${n.conditions}`));

  // A decisão está à vista; a razão só se a pessoa a quiser, atrás de um clique.
  if (usable) {
    const limits = buildLimits(n, lastData && lastData.light_pollution);
    limits.hidden = true;
    const why = el("button", "why-toggle", "o que baixa o score");
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

  detailEl.append(block("Condições", buildConds(n)));

  const raw = buildRaw(hrs);
  raw.hidden = true;
  const toggle = el("button", "raw-toggle", "tabela completa");
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    raw.hidden = !raw.hidden;
    toggle.classList.toggle("is-open", !raw.hidden);
  });
  const meteo = el("div");
  meteo.append(buildMeteogram(hrs), raw);
  detailEl.append(block("A noite hora a hora", meteo, toggle));

  if (n.objects.length) {
    // Cúpula: o céu visto de baixo, com slider para varrer a noite.
    const wrap = el("div", "sky-wrap");
    wrap.append(buildSkyDome(n, lastData.latitude, lastData.longitude, lastData.timezone),
                el("p", "sky-cap", "Olhando para cima. Arrasta o slider para ver o céu mover-se ao longo da noite; passa o rato por um objecto para os detalhes."));
    detailEl.append(block("O céu nesta noite", wrap));

    detailEl.append(block("O que observar, e quando", buildObjectsFilter(n, hrs)));
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
    placeSkyEl.textContent = "poluição luminosa não aplicada, scores optimistas em zonas urbanas";
  }

  if (!selectedDate || !data.nights.some((n) => n.date === selectedDate)) {
    const usable = data.nights.filter((n) => n.score > 0);
    selectedDate = (usable.length
      ? usable.reduce((a, b) => (b.score > a.score ? b : a))
      : data.nights[0]).date;
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
              el("span", "sug-sub", [r.admin1, r.country].filter(Boolean).join(" · ")));
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
  setStatus("A procurar localidade…");
  try {
    current = await geocode(name);
    await loadForecast();
  } catch (err) {
    setStatus(`⚠️ ${err.message}`);
  }
});

geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) { setStatus("⚠️ O browser não suporta geolocalização."); return; }
  setStatus("A obter a tua localização…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      current = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: "a tua localização" };
      loadForecast();
    },
    () => setStatus("⚠️ Não foi possível obter a localização."),
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
  compareBody.innerHTML = "<p class='status'>A calcular…</p>";

  const results = await Promise.all(places.map(async (p) => {
    try {
      return { place: p, data: await computeForecast(p.lat, p.lon, mode) };
    } catch { return { place: p, error: true }; }
  }));

  const ok = results.filter((r) => !r.error);
  if (!ok.length) {
    compareBody.innerHTML = "<p class='status'>Não foi possível calcular.</p>";
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
    hr.append(el("th", null, dt.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric" })));
  }
  thead.append(hr);

  const tbody = document.createElement("tbody");
  for (const r of ok) {
    const tr = document.createElement("tr");
    const th = el("th", "cmp-place");
    th.append(document.createTextNode(r.place.name),
              el("span", null, r.data.light_pollution
                ? r.data.light_pollution.description : "poluição luminosa desconhecida"));
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
  verdict.append(document.createTextNode("Melhor combinação: "));
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

let map = null, marker = null, picked = null;

function initMap() {
  // O Leaflet só mede bem o contentor depois de visível.
  map = L.map("map").setView(current ? [current.lat, current.lon] : [39.6, -8.0],
                             current ? 10 : 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.on("click", (e) => {
    picked = { lat: e.latlng.lat, lon: e.latlng.lng };
    if (marker) marker.setLatLng(e.latlng);
    else marker = L.marker(e.latlng).addTo(map);
    mapCoords.textContent = `${picked.lat.toFixed(4)}, ${picked.lon.toFixed(4)}`;
    mapConfirm.disabled = false;
  });
}

mapBtn.addEventListener("click", () => {
  mapModal.hidden = false;
  if (!map) initMap();
  setTimeout(() => map.invalidateSize(), 50);
  if (current) map.setView([current.lat, current.lon], 10);
});
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
