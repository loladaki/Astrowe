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
const SAVED_KEY = "astrowe.places";
const COUNTRY_KEY = "astrowe.country";
const TOP_OBJECTS = 6;

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
function moonSVG(illumPct, waxing, size = 26) {
  const k = Math.max(0, Math.min(1, illumPct / 100));
  const R = 13, cx = 15, cy = 15;
  const rx = (R * Math.abs(1 - 2 * k)).toFixed(2);
  const outer = waxing ? 1 : 0;
  const inner = (waxing === (k > 0.5)) ? 0 : 1;

  const g = svg("svg", { width: size, height: size, viewBox: "0 0 30 30", "aria-hidden": "true" });
  g.append(svg("circle", { cx, cy, r: R, fill: "var(--border-lit)" }));
  if (k > 0.01) {
    g.append(svg("path", {
      d: `M ${cx} ${cy - R} A ${R} ${R} 0 0 ${outer} ${cx} ${cy + R}` +
         ` A ${rx} ${R} 0 0 ${inner} ${cx} ${cy - R} Z`,
      fill: "var(--text)",     // é o objecto mais brilhante do céu; que se veja
    }));
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
    g.append(svg("circle", { cx: 15, cy: 15, r: 10, "stroke-dasharray": "4 3", ...st }));
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
  try {
    const res = await fetch(
      `/api/forecast?lat=${current.lat}&lon=${current.lon}&mode=${mode}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Erro ${res.status}`);
    }
    lastData = await res.json();
    if (!keepDate) selectedDate = null;
    render();
    saveBtn.hidden = false;
    setStatus("");
  } catch (e) {
    setStatus(`⚠️ ${e.message}`);
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

function barClass(alt) {
  if (alt === null || alt < 15) return "b-none";
  return alt >= 35 ? "b-good" : "b-ok";
}

const weekdayShort = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "");
const weekdayLong = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "short" });

/* ------------------------------------------------- painéis */

function panel(title, node) {
  const p = el("section", "panel");
  if (title) p.append(el("div", "panel-title", title));
  p.append(node);
  return p;
}

function buildLimits(n) {
  const box = el("div", "limits");
  if (!n.limiting.length) {
    box.append(el("div", "limits-none", "Nada a limitar — condições no máximo."));
    return box;
  }
  const worst = n.limiting[0].cost_points;
  for (const f of n.limiting) {
    const row = el("div");
    const head = el("div", "limit-row");
    head.append(el("span", null, f.label), el("span", null, `−${f.cost_points}`));
    const bar = el("div", "limit-bar");
    const fill = el("div", "limit-fill");
    fill.style.width = `${Math.max(6, (f.cost_points / worst) * 100)}%`;
    fill.style.background = f.cost_points >= worst * 0.66 ? "var(--poor)"
      : f.cost_points >= worst * 0.33 ? "var(--ok)" : "var(--good)";
    bar.append(fill);
    row.append(head, bar);
    box.append(row);
  }
  return box;
}

function condCard({ icon, tag, value, sub, spark, moon }) {
  const c = el("div", "card");
  const top = el("div", "card-top");
  top.append(moon || icon || el("span"), el("span", "card-tag", tag));
  c.append(top, el("div", "card-value", value));
  if (sub) c.append(el("div", "card-sub", sub));
  if (spark) c.append(spark);
  return c;
}

function buildCards(n) {
  const grid = el("div", "cards");
  const c = n.cards;

  grid.append(condCard({
    moon: moonSVG(n.moon_illumination_pct, n.moon_waxing, 24),
    tag: "Lua",
    value: c ? c.moon_label : n.moon_phase,
    sub: `${Math.round(n.moon_illumination_pct)}% iluminada`,
  }));

  grid.append(condCard({
    icon: iconSVG("cloud"), tag: "nuvens",
    value: c ? c.clouds_label : "—",
    spark: c ? sparkline(c.clouds_spark, true) : null,
  }));

  const dewWarn = c && /Prov|Poss/.test(c.dew_label);
  grid.append(condCard({
    icon: iconSVG("droplet", 20, dewWarn ? "icon warn" : "icon"), tag: "orvalho",
    value: c ? c.dew_label : "—",
    spark: c ? sparkline(c.dew_spark, false) : null,
  }));

  grid.append(condCard({
    icon: iconSVG("thermo"), tag: "temperatura",
    value: c ? c.temp_label : "—",
    sub: [n.wind_kmh !== null ? `vento ${Math.round(n.wind_kmh)} km/h` : "",
          `seeing ${n.seeing}`].filter(Boolean).join(" · "),
  }));

  return grid;
}

/* --- meteograma: horas em colunas, variáveis em linhas --- */

function timeHeader(win) {
  const row = el("div", "tgrid");
  row.append(el("div"));
  for (const h of win) row.append(el("div", "tgrid-head", hh(h.time)));
  return row;
}

function meteoRow(label, win, kind, fmt) {
  const row = el("div", "tgrid");
  row.append(el("div", "tgrid-label", label));
  for (const h of win) {
    const v = kind === "cloud" ? h.cloud_total_pct
      : kind === "jet" ? h.jet_stream_kmh
      : kind === "moon" ? h.moon_altitude_deg
      : kind === "spread" ? h.dew_spread_c
      : h.temperature_c;
    row.append(el("div", `cell ${cellClass(kind, v)}`, fmt(v)));
  }
  return row;
}

function buildMeteogram(win) {
  const box = el("div");
  box.append(timeHeader(win));
  box.append(meteoRow("nuvens", win, "cloud", (v) => v === null ? "—" : `${Math.round(v)}%`));
  box.append(meteoRow("seeing", win, "jet",
    (v) => v === null ? "—" : v < 60 ? "bom" : v < 100 ? "médio" : "fraco"));
  box.append(meteoRow("Lua", win, "moon",
    (v) => v === null ? "—" : v <= 0 ? "posta" : `${Math.round(v)}°`));
  box.append(meteoRow("spread", win, "spread", (v) => v === null ? "—" : `${v.toFixed(1)}°`));
  box.append(meteoRow("temp", win, "temp", (v) => v === null ? "—" : `${Math.round(v)}°`));
  return box;
}

/* --- janelas dos objectos: uma barra por alvo --- */

function objectRow(o) {
  const row = el("div", "tgrid" + (o.washed_out ? " is-washed" : ""));
  const label = el("div", "obj-label");
  label.append(symbolSVG(o.symbol, 14));
  const a = el("a", null, o.name);
  a.href = o.url; a.target = "_blank"; a.rel = "noopener";
  a.title = `${o.kind}${o.magnitude !== null ? ` · mag ${o.magnitude}` : ""}` +
            ` · culmina a ${Math.round(o.max_altitude_deg)}°`;
  label.append(a);
  row.append(label);

  for (const alt of o.altitudes) {
    const cell = el("div", `bar ${barClass(alt)}`);
    if (alt !== null) cell.title = `${Math.round(alt)}°`;
    row.append(cell);
  }
  return row;
}

function buildObjects(n, win) {
  const box = el("div");
  box.append(timeHeader(win));

  const shown = n.objects.slice(0, TOP_OBJECTS);
  const rest = n.objects.slice(TOP_OBJECTS);
  for (const o of shown) box.append(objectRow(o));

  const legend = el("div", "legend");
  const mk = (cls, txt) => {
    const s = el("span");
    const sw = el("span", "swatch");
    sw.style.background = cls;
    s.append(sw, document.createTextNode(txt));
    return s;
  };
  legend.append(mk("var(--good)", "alto (≥35°)"), mk("var(--ok)", "utilizável"),
                mk("var(--border)", "baixo ou abaixo do horizonte"));
  box.append(legend);

  if (rest.length) {
    const more = el("button", "more", `ver os outros ${rest.length} →`);
    more.type = "button";
    more.addEventListener("click", () => {
      more.remove();
      for (const o of rest) box.insertBefore(objectRow(o), legend);
    });
    box.append(more);
  }
  return box;
}

/* --- eventos e dados crus --- */

function buildEvents(n) {
  if (!n.meteor_shower && !n.milky_way) return null;
  const box = el("div", "events");
  const add = (icon, name, text, when) => {
    const row = el("div", "event");
    row.append(el("div", "event-icon", icon));
    const body = el("div");
    body.append(el("div", "event-name", name), el("div", "event-text", text));
    if (when) body.append(el("div", "event-when", when));
    row.append(body);
    box.append(row);
  };
  if (n.meteor_shower) {
    const m = n.meteor_shower;
    add("☄️", m.name, m.summary,
      `radiante a ${Math.round(m.radiant_altitude_deg)}° ${m.radiant_direction}` +
      (m.transit_time ? ` · mais alto às ${hhmm(m.transit_time)}` : ""));
  }
  if (n.milky_way) {
    const g = n.milky_way;
    add("🌌", "Via Láctea", g.summary,
      g.transit_time ? `mais alto às ${hhmm(g.transit_time)} (${Math.round(g.max_altitude_deg)}° máx.)`
                     : `${g.trend} · máximo possível ${Math.round(g.max_altitude_deg)}°`);
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
  for (const n of data.nights) {
    const usable = n.window_start !== null;
    const b = el("button", `night-btn ${stripClass(n.score, usable)}` +
                           (n.date === selectedDate ? " is-selected" : ""));
    b.type = "button";
    b.append(el("span", "d", weekdayShort(n.date)),
             el("span", "n", usable ? String(n.score) : "—"),
             moonSVG(n.moon_illumination_pct, n.moon_waxing, 17));
    b.title = `${weekdayLong(n.date)} — ${n.headline}`;
    b.addEventListener("click", () => { selectedDate = n.date; render(); });
    stripEl.append(b);
  }
}

function renderDetail(n) {
  detailEl.innerHTML = "";
  const usable = n.window_start !== null;

  const v = el("div", "verdict");
  const ring = el("div", `verdict-score ${scoreClass(n.score, usable)}`,
                  usable ? String(n.score) : "—");
  const body = el("div");
  body.append(el("div", "verdict-head", n.headline));
  body.append(el("div", "verdict-sub", usable
    ? `${weekdayLong(n.date)} · ${hhmm(n.window_start)}–${hhmm(n.window_end)} · ${n.conditions}`
    : `${weekdayLong(n.date)} · ${n.conditions}`));
  v.append(ring, body);
  detailEl.append(v);

  if (!n.hours.length) return;
  const win = n.hours.filter((h) => h.in_window);
  detailEl.style.setProperty("--cols", String(win.length));

  const two = el("div", "grid-2");
  two.append(panel("O que te limita", buildLimits(n)), panel("Condições", buildCards(n)));
  detailEl.append(two);

  detailEl.append(panel("A noite hora a hora", buildMeteogram(win)));
  if (n.objects.length) detailEl.append(panel("Quando observar cada alvo", buildObjects(n, win)));

  const ev = buildEvents(n);
  if (ev) detailEl.append(panel("Esta noite", ev));

  const raw = buildRaw(n.hours);
  raw.hidden = true;
  const toggle = el("button", "raw-toggle", "Ver todos os dados ▾");
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    raw.hidden = !raw.hidden;
    toggle.textContent = raw.hidden ? "Ver todos os dados ▾" : "Esconder dados ▴";
  });
  const rawPanel = el("section", "panel");
  rawPanel.append(toggle, raw);
  detailEl.append(rawPanel);
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
    placeSkyEl.textContent = "poluição luminosa não aplicada — scores optimistas em zonas urbanas";
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
      const res = await fetch(`/api/forecast?lat=${p.lat}&lon=${p.lon}&mode=${mode}`);
      if (!res.ok) return { place: p, error: true };
      return { place: p, data: await res.json() };
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
  verdict.append(document.createTextNode(` — ${best.night.headline.toLowerCase()}, score ${best.score}.`));

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
