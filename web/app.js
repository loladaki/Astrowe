"use strict";

const $ = (id) => document.getElementById(id);

const form = $("search-form");
const placeInput = $("place");
const suggestionsEl = $("suggestions");
const geoBtn = $("geo-btn");
const mapBtn = $("map-btn");
const statusEl = $("status");
const resultEl = $("result");
const placeNameEl = $("place-name");
const placeSkyEl = $("place-sky");
const verdictEl = $("verdict");
const nightsEl = $("nights");
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

let current = null;      // { lat, lon, label }
let mode = "deepsky";

const hhmm = (iso) => iso.slice(11, 16);
const num = (v, d = 0) => (v === null || v === undefined ? "—" : v.toFixed(d));

function setStatus(msg) {
  statusEl.hidden = !msg;
  statusEl.textContent = msg || "";
}

/* ------------------------------------------------- geocodificação */

/**
 * País a privilegiar nas sugestões. O locale do browser é só o ponto de
 * partida e engana-se com frequência (um browser em inglês num utilizador
 * português dá "GB"), por isso passamos a preferir o país do último local
 * escolhido.
 */
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

/** A API ordena por relevância global e enterra localidades pequenas: dois
 *  pedidos em paralelo, com os do país preferido à cabeça. */
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

/* ------------------------------------------------- carregar dados */

async function loadForecast() {
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
    render(await res.json());
    saveBtn.hidden = false;
    setStatus("");
  } catch (e) {
    setStatus(`⚠️ ${e.message}`);
  }
}

/* ------------------------------------------------- desenhar */

function scoreClass(score, usable) {
  if (!usable) return "s-none";
  if (score >= 55) return "s-good";
  if (score >= 35) return "s-ok";
  return "s-poor";
}

function qualityClass(q) {
  if (q >= 0.7) return "q-good";
  if (q >= 0.45) return "q-ok";
  return "q-poor";
}

function weekdayLabel(date) {
  return new Date(date + "T12:00:00").toLocaleDateString("pt-PT", {
    weekday: "long", day: "numeric", month: "short",
  });
}

function section(title, node) {
  const sec = document.createElement("section");
  sec.className = "sec";
  const h = document.createElement("div");
  h.className = "sec-title";
  h.textContent = title;
  sec.append(h, node);
  return sec;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/* --- secções do detalhe --- */

function buildLimits(n) {
  const box = el("div", "limits");
  if (!n.limiting.length) {
    box.append(el("div", "limits-none", "Nada a limitar — condições no máximo."));
    return box;
  }
  const worst = n.limiting[0].cost_points;
  for (const f of n.limiting) {
    const row = el("div", "limit");
    row.append(el("span", "limit-label", f.label),
               el("span", "limit-cost", `−${f.cost_points}`));
    const bar = el("div", "limit-bar");
    const fill = el("div", "limit-fill");
    fill.style.width = `${Math.max(6, (f.cost_points / worst) * 100)}%`;
    bar.append(fill);
    row.append(bar);
    box.append(row);
  }
  return box;
}

function fact(label, value, hint, href) {
  const box = el("div", "fact");
  box.append(el("div", "fact-label", label));
  const v = href ? el("a", "fact-value", value) : el("div", "fact-value", value);
  if (href) { v.href = href; v.target = "_blank"; v.rel = "noopener"; }
  box.append(v);
  if (hint) box.append(el("div", "fact-hint", hint));
  return box;
}

function buildFacts(n) {
  const grid = el("div", "facts");
  grid.append(fact("Lua", n.moon_phase,
    [n.moonrise && `nasce ${hhmm(n.moonrise)}`,
     n.moonset && `põe-se ${hhmm(n.moonset)}`].filter(Boolean).join(" · "),
    "https://telescopius.com/solar-system/moon-calendar"));
  grid.append(fact("Seeing", n.seeing, "estabilidade do ar"));
  grid.append(fact("Orvalho", n.dew_risk,
    n.dew_risk === "alto" ? "as ópticas vão embaciar"
      : n.dew_risk === "moderado" ? "leva anti-orvalho" : "sem problema"));
  if (n.temperature_c !== null) {
    const hint = [
      n.feels_like_c !== null && Math.abs(n.feels_like_c - n.temperature_c) >= 1
        ? `sente-se ${n.feels_like_c}°C` : "",
      n.wind_kmh !== null ? `vento ${Math.round(n.wind_kmh)} km/h` : "",
    ].filter(Boolean).join(" · ");
    grid.append(fact("Temperatura", `${n.temperature_c}°C`, hint));
  }
  return grid;
}

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
      g.transit_time
        ? `mais alto às ${hhmm(g.transit_time)} (${Math.round(g.max_altitude_deg)}° máx.)`
        : `${g.trend} · máximo possível ${Math.round(g.max_altitude_deg)}°`);
  }
  return box;
}

function buildStrip(hours) {
  const strip = el("div", "strip");
  for (const h of hours) {
    const col = el("div", "hour" + (h.in_window ? " in-window" : ""));
    col.title = `${hhmm(h.time)} · qualidade ${(h.quality * 100).toFixed(0)}% · ${h.reason}`;
    const wrap = el("div", "hour-bar-wrap");
    const bar = el("div", `hour-bar ${qualityClass(h.quality)}`);
    bar.style.height = `${Math.max(6, h.quality * 100)}%`;
    wrap.append(bar);
    col.append(wrap, el("div", "hour-time", hhmm(h.time)), el("div", "hour-why", h.reason));
    strip.append(col);
  }
  return strip;
}

function buildObjects(objs) {
  const list = el("div", "objects");
  for (const o of objs) {
    const row = el("div", "obj" + (o.washed_out ? " is-washed" : ""));

    const name = el("a", "obj-name", o.name);
    name.href = o.url;
    name.target = "_blank";
    name.rel = "noopener";
    name.title = `Ver ${o.name} no Telescopius`;
    const kind = el("span", "obj-kind",
      o.magnitude !== null ? `${o.kind} · mag ${o.magnitude}` : o.kind);
    const nameWrap = el("div");
    nameWrap.append(name, kind);

    const pos = el("div", "obj-pos",
      `${Math.round(o.altitude_deg)}° ${o.direction}` +
      (o.airmass !== null ? ` · airmass ${o.airmass.toFixed(2)}` : ""));
    pos.title = "altura e direcção agora · airmass = atmosfera atravessada (1.0 no zénite)";

    const when = el("div", "obj-when");
    if (o.transit_time) {
      when.append(document.createTextNode(`${o.trend} · mais alto às `));
      when.append(el("b", null, hhmm(o.transit_time)));
      when.append(document.createTextNode(` (${Math.round(o.max_altitude_deg)}°)`));
    } else {
      when.textContent = `${o.trend} · máximo possível ${Math.round(o.max_altitude_deg)}°`;
    }
    if (o.washed_out) when.textContent += " · apagado pelo luar";

    row.append(nameWrap, pos, when);
    list.append(row);
  }
  return list;
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

function buildDetail(n) {
  const detail = el("div", "detail");
  detail.hidden = true;

  detail.append(section("O que te limita", buildLimits(n)));
  detail.append(section("Condições", buildFacts(n)));

  const ev = buildEvents(n);
  if (ev) detail.append(section("Esta noite", ev));

  detail.append(section("Ao longo da noite", buildStrip(n.hours)));

  if (n.objects.length) {
    detail.append(section("O que observar, e quando", buildObjects(n.objects)));
  }

  const raw = buildRaw(n.hours);
  raw.hidden = true;
  const toggle = el("button", "raw-toggle", "Ver todos os dados ▾");
  toggle.type = "button";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    raw.hidden = !raw.hidden;
    toggle.textContent = raw.hidden ? "Ver todos os dados ▾" : "Esconder dados ▴";
  });
  const rawSec = el("div", "sec");
  rawSec.append(toggle, raw);
  detail.append(rawSec);

  return detail;
}

function buildNight(n, isBest) {
  const usable = n.window_start !== null;
  const card = el("article", "night" + (isBest ? " is-best" : ""));

  const head = el("div", "night-head");

  const score = el("div", `score ${scoreClass(n.score, usable)}`);
  score.append(el("span", null, usable ? n.score : "—"));

  const body = el("div");
  const day = el("div", "night-day");
  day.append(el("span", null, weekdayLabel(n.date)));
  if (isBest) day.append(el("span", "night-tag", "melhor"));
  body.append(day);

  if (usable) {
    body.append(el("div", "night-window",
      `${n.verdict} · ${hhmm(n.window_start)}–${hhmm(n.window_end)} · ${n.window_hours}h`));
  } else {
    body.append(el("div", "night-window", n.verdict));
  }
  body.append(el("div", "night-cond", n.conditions));

  head.append(score, body, el("div", "chevron", "▾"));
  card.append(head);

  if (n.hours.length) {
    const detail = buildDetail(n);
    card.append(detail);
    head.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      card.classList.toggle("is-open", !detail.hidden);
    });
  } else {
    head.style.cursor = "default";
    head.querySelector(".chevron").hidden = true;
  }
  return card;
}

function render(data) {
  resultEl.hidden = false;
  nightsEl.innerHTML = "";

  placeNameEl.textContent = current.label;
  const lp = data.light_pollution;
  if (lp) {
    placeSkyEl.className = "place-sky";
    placeSkyEl.textContent = `${lp.description} · Bortle ${lp.bortle} · SQM ${lp.sqm}`;
  } else {
    placeSkyEl.className = "place-sky is-missing";
    placeSkyEl.textContent = "poluição luminosa não aplicada — scores optimistas em zonas urbanas";
  }

  const usable = data.nights.filter((n) => n.score > 0);
  const best = usable.length
    ? usable.reduce((a, b) => (b.score > a.score ? b : a)) : null;

  verdictEl.innerHTML = "";
  if (best) {
    verdictEl.append(document.createTextNode("Das próximas noites, a melhor é "));
    verdictEl.append(el("strong", null, weekdayLabel(best.date)));
    verdictEl.append(document.createTextNode(
      ` — ${best.window_hours}h de céu utilizável, das ${hhmm(best.window_start)} às ${hhmm(best.window_end)}.`));
  } else {
    verdictEl.textContent = "Nenhuma noite com condições utilizáveis nos próximos dias.";
  }

  for (const n of data.nights) {
    nightsEl.append(buildNight(n, best !== null && n.date === best.date));
  }
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
  if (e.key === "ArrowDown") {
    e.preventDefault(); setHighlight((highlighted + 1) % suggestions.length);
  } else if (e.key === "ArrowUp") {
    e.preventDefault(); setHighlight((highlighted - 1 + suggestions.length) % suggestions.length);
  } else if (e.key === "Enter" && highlighted >= 0) {
    e.preventDefault(); chooseSuggestion(highlighted);
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
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
  if (!navigator.geolocation) {
    setStatus("⚠️ O browser não suporta geolocalização.");
    return;
  }
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
    del.addEventListener("click", () => {
      storeSaved(loadSaved().filter((x) => x.name !== p.name));
    });
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

function compareClass(score) {
  if (score >= 55) return "cmp-good";
  if (score >= 35) return "cmp-ok";
  return "cmp-poor";
}

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
  verdict.append(el("strong", null, `${best.place}, ${weekdayLabel(best.night.date)}`));
  verdict.append(document.createTextNode(` — score ${best.score}. ${best.night.conditions}`));

  compareBody.innerHTML = "";
  compareBody.append(verdict, table);
}

compareBtn.addEventListener("click", openCompare);
compareClose.addEventListener("click", () => { compareModal.hidden = true; });
compareModal.addEventListener("click", (e) => {
  if (e.target === compareModal) compareModal.hidden = true;
});

/* ------------------------------------------------- mapa */

let map = null;
let marker = null;
let picked = null;

function initMap() {
  // O Leaflet só mede bem o contentor depois de visível, por isso o mapa
  // nasce à primeira abertura do modal, não no arranque.
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
  setTimeout(() => map.invalidateSize(), 50);   // contentor acabou de aparecer
  if (current) map.setView([current.lat, current.lon], 10);
});
mapClose.addEventListener("click", () => { mapModal.hidden = true; });
mapModal.addEventListener("click", (e) => {
  if (e.target === mapModal) mapModal.hidden = true;
});
mapConfirm.addEventListener("click", () => {
  if (!picked) return;
  current = {
    lat: picked.lat, lon: picked.lon,
    label: `${picked.lat.toFixed(4)}, ${picked.lon.toFixed(4)}`,
  };
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
    loadForecast();
  });
});

renderSaved();
