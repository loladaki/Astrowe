"use strict";

const form = document.getElementById("search-form");
const placeInput = document.getElementById("place");
const geoBtn = document.getElementById("geo-btn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const siteEl = document.getElementById("site");
const suggestionsEl = document.getElementById("suggestions");
const mapBtn = document.getElementById("map-btn");
const mapModal = document.getElementById("map-modal");
const mapClose = document.getElementById("map-close");
const mapConfirm = document.getElementById("map-confirm");
const mapCoords = document.getElementById("map-coords");
const savedListEl = document.getElementById("saved-list");
const saveBtn = document.getElementById("save-btn");
const compareBtn = document.getElementById("compare-btn");
const saveForm = document.getElementById("save-form");
const saveName = document.getElementById("save-name");
const saveConfirm = document.getElementById("save-confirm");
const saveCancel = document.getElementById("save-cancel");
const compareModal = document.getElementById("compare-modal");
const compareClose = document.getElementById("compare-close");
const compareBody = document.getElementById("compare-body");
const nightsEl = document.getElementById("nights");
const modeBtns = document.querySelectorAll(".mode-btn");

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

// Última localização consultada, para o toggle de modo poder repetir a query.
let current = null; // { lat, lon, label }
let mode = "deepsky";

function setStatus(msg) {
  if (!msg) { statusEl.hidden = true; return; }
  statusEl.hidden = false;
  statusEl.textContent = msg;
}

const COUNTRY_KEY = "astrowe.country";

/**
 * País a privilegiar nas sugestões.
 *
 * O locale do browser é só o ponto de partida e engana-se com frequência —
 * um browser em inglês num utilizador português dá "GB". Por isso, assim que
 * se escolhe uma localidade, passamos a preferir o país dela.
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

/**
 * Resultados com os do país do utilizador à cabeça.
 *
 * A API ordena por relevância global, o que enterra localidades pequenas:
 * escrever "Fund" devolvia cidades americanas antes do Fundão. Fazemos dois
 * pedidos em paralelo e juntamos, com os locais primeiro.
 */
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

/** Etiqueta legível: "Fundão, Castelo Branco, PT" — sem repetir a região. */
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

async function loadForecast() {
  if (!current) return;
  setStatus(`A calcular as noites para ${current.label}…`);
  summaryEl.hidden = true;
  siteEl.hidden = true;
  nightsEl.innerHTML = "";
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

function scoreClass(score, hasWindow) {
  if (!hasWindow) return "score-none";
  if (score >= 55) return "score-good";
  if (score >= 35) return "score-ok";
  return "score-poor";
}

function renderSite(data) {
  siteEl.hidden = false;
  const lp = data.light_pollution;
  if (lp) {
    siteEl.className = "site";
    // Linguagem corrente à frente; os números para quem os quiser.
    siteEl.innerHTML =
      `<strong>🔦 ${lp.description}</strong>` +
      `<span class="site-nums">Bortle ${lp.bortle} · SQM ${lp.sqm} mag/arcsec²` +
      ` — propriedade do local, já incluída no score</span>`;
  } else {
    siteEl.className = "site site-missing";
    siteEl.textContent =
      "🔦 Poluição luminosa não aplicada (falta a chave da API do lightpollutionmap.info). " +
      "Os scores estão otimistas para locais urbanos.";
  }
}

function qualityClass(q) {
  if (q >= 0.7) return "q-good";
  if (q >= 0.45) return "q-ok";
  return "q-poor";
}

const hhmm = (iso) => iso.slice(11, 16);
const num = (v, digits = 0) => (v === null || v === undefined ? "—" : v.toFixed(digits));

function buildHourStrip(hours) {
  const strip = document.createElement("div");
  strip.className = "hour-strip";
  for (const h of hours) {
    const col = document.createElement("div");
    col.className = "hour-col" + (h.in_window ? " in-window" : "");
    col.title = `${hhmm(h.time)} · qualidade ${(h.quality * 100).toFixed(0)}% · ${h.reason}`;

    const barWrap = document.createElement("div");
    barWrap.className = "bar-wrap";
    const bar = document.createElement("div");
    bar.className = `bar ${qualityClass(h.quality)}`;
    bar.style.height = `${Math.max(4, h.quality * 100)}%`;
    barWrap.appendChild(bar);

    const time = document.createElement("div");
    time.className = "hour-time";
    time.textContent = hhmm(h.time);

    const reason = document.createElement("div");
    reason.className = "hour-reason";
    reason.textContent = h.reason;

    col.append(barWrap, time, reason);
    strip.appendChild(col);
  }
  return strip;
}

const RAW_COLUMNS = [
  ["Hora", (h) => hhmm(h.time)],
  ["Qual.", (h) => `${(h.quality * 100).toFixed(0)}%`],
  ["Nuvens B/M/A", (h) => `${num(h.cloud_low_pct)}/${num(h.cloud_mid_pct)}/${num(h.cloud_high_pct)}`],
  ["Total", (h) => `${num(h.cloud_total_pct)}%`],
  ["Temp", (h) => `${num(h.temperature_c, 1)}°C`],
  ["Orvalho", (h) => `${num(h.dew_point_c, 1)}°C`],
  ["Spread", (h) => `${num(h.dew_spread_c, 1)}°C`],
  ["HR", (h) => `${num(h.humidity_pct)}%`],
  ["Vento", (h) => `${num(h.wind_speed_kmh)} km/h`],
  ["Rajada", (h) => `${num(h.wind_gusts_kmh)} km/h`],
  ["Jet 250hPa", (h) => `${num(h.jet_stream_kmh)} km/h`],
  ["Visib.", (h) => (h.visibility_m == null ? "—" : `${(h.visibility_m / 1000).toFixed(0)} km`)],
  ["Lua alt", (h) => `${num(h.moon_altitude_deg)}°`],
  ["Lua ilum", (h) => `${num(h.moon_illumination_pct)}%`],
  ["Prec.", (h) => `${num(h.precipitation_prob_pct)}%`],
];

function buildRawTable(hours) {
  const wrap = document.createElement("div");
  wrap.className = "raw-wrap";
  const table = document.createElement("table");
  table.className = "raw-table";

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const [label] of RAW_COLUMNS) {
    const th = document.createElement("th");
    th.textContent = label;
    hr.appendChild(th);
  }
  thead.appendChild(hr);

  const tbody = document.createElement("tbody");
  for (const h of hours) {
    const tr = document.createElement("tr");
    if (h.in_window) tr.className = "in-window";
    for (const [, fn] of RAW_COLUMNS) {
      const td = document.createElement("td");
      td.textContent = fn(h);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

function factBox(label, value, hint, href) {
  const box = document.createElement("div");
  box.className = "fact";
  const l = document.createElement("div");
  l.className = "fact-label";
  l.textContent = label;

  let v;
  if (href) {
    v = document.createElement("a");
    v.href = href;
    v.target = "_blank";
    v.rel = "noopener";
  } else {
    v = document.createElement("div");
  }
  v.className = "fact-value";
  v.textContent = value;

  box.append(l, v);
  if (hint) {
    const t = document.createElement("div");
    t.className = "fact-hint";
    t.textContent = hint;
    box.appendChild(t);
  }
  return box;
}

function buildConditions(n) {
  const grid = document.createElement("div");
  grid.className = "facts";

  grid.appendChild(factBox("Lua", n.moon_phase,
    [n.moonrise && `nasce ${hhmm(n.moonrise)}`,
     n.moonset && `põe-se ${hhmm(n.moonset)}`].filter(Boolean).join(" · "),
    "https://telescopius.com/solar-system/moon-calendar"));

  grid.appendChild(factBox("Seeing", n.seeing, "estabilidade do ar"));

  grid.appendChild(factBox("Risco de orvalho", n.dew_risk,
    n.dew_risk === "alto" ? "as ópticas vão embaciar"
      : n.dew_risk === "moderado" ? "leva resistência anti-orvalho" : "sem problema"));

  if (n.temperature_c !== null) {
    const feels = n.feels_like_c !== null && Math.abs(n.feels_like_c - n.temperature_c) >= 1
      ? `sente-se ${n.feels_like_c}°C` : "";
    const wind = n.wind_kmh !== null ? `vento ${Math.round(n.wind_kmh)} km/h` : "";
    grid.appendChild(factBox("Temperatura", `${n.temperature_c}°C`,
      [feels, wind].filter(Boolean).join(" · ")));
  }
  return grid;
}

function buildObjects(objs) {
  const wrap = document.createElement("div");
  wrap.className = "objects";

  const title = document.createElement("div");
  title.className = "objects-title";
  title.textContent = "O que se vê a meio da janela";
  wrap.appendChild(title);

  const list = document.createElement("div");
  list.className = "object-list";
  for (const o of objs) {
    const item = document.createElement("div");
    item.className = "object" + (o.washed_out ? " washed" : "");

    // Ficha do objecto no Telescopius (a URL vem do backend).
    const name = document.createElement("a");
    name.className = "obj-name";
    name.textContent = o.name;
    name.href = o.url;
    name.target = "_blank";
    name.rel = "noopener";
    name.title = `Ver ${o.name} no Telescopius`;

    const meta = document.createElement("span");
    meta.className = "obj-meta";
    const mag = o.magnitude !== null ? ` · mag ${o.magnitude}` : "";
    meta.textContent = `${o.kind}${mag} · ${Math.round(o.altitude_deg)}° ${o.direction}`;

    item.append(name, meta);
    if (o.washed_out) {
      const warn = document.createElement("span");
      warn.className = "obj-warn";
      warn.textContent = "apagado pelo luar";
      item.appendChild(warn);
    }
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

function buildDetail(n) {
  const detail = document.createElement("div");
  detail.className = "night-detail";
  detail.hidden = true;

  if (n.limiting.length) {
    const lim = document.createElement("div");
    lim.className = "limiting";
    const title = document.createElement("span");
    title.className = "limiting-title";
    title.textContent = "O que te limita:";
    lim.appendChild(title);
    for (const f of n.limiting) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `${f.label} −${f.cost_points}`;
      lim.appendChild(chip);
    }
    detail.appendChild(lim);
  } else {
    const lim = document.createElement("div");
    lim.className = "limiting";
    lim.textContent = "Nada a limitar esta noite — condições no máximo.";
    detail.appendChild(lim);
  }

  detail.appendChild(buildConditions(n));
  detail.appendChild(buildHourStrip(n.hours));
  if (n.objects.length) detail.appendChild(buildObjects(n.objects));

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "raw-toggle";
  toggle.textContent = "Ver dados completos ▾";
  const raw = buildRawTable(n.hours);
  raw.hidden = true;
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    raw.hidden = !raw.hidden;
    toggle.textContent = raw.hidden ? "Ver dados completos ▾" : "Esconder dados ▴";
  });

  detail.append(toggle, raw);
  return detail;
}

function render(data) {
  summaryEl.hidden = false;
  summaryEl.textContent = data.summary;
  renderSite(data);

  for (const n of data.nights) {
    const hasWindow = n.window_start !== null;
    const card = document.createElement("article");
    card.className = "night";

    const head = document.createElement("div");
    head.className = "night-head";

    const badge = document.createElement("div");
    badge.className = `score-badge ${scoreClass(n.score, hasWindow)}`;
    badge.textContent = hasWindow ? n.score : "—";

    const body = document.createElement("div");
    body.className = "night-body";

    const weekday = new Date(n.date + "T12:00:00").toLocaleDateString("pt-PT", {
      weekday: "long", day: "numeric", month: "short",
    });

    const heading = document.createElement("h3");
    heading.textContent = weekday;

    const verdict = document.createElement("div");
    verdict.className = "verdict";
    verdict.textContent = hasWindow
      ? `${n.verdict} · melhor janela ${n.window_hours}h`
      : n.verdict;

    const details = document.createElement("p");
    details.className = "details";
    details.textContent = n.details;

    body.append(heading, verdict, details);

    const chevron = document.createElement("div");
    chevron.className = "chevron";
    chevron.textContent = "▾";

    head.append(badge, body, chevron);
    card.appendChild(head);

    if (n.hours.length) {
      const detail = buildDetail(n);
      card.appendChild(detail);
      head.addEventListener("click", () => {
        detail.hidden = !detail.hidden;
        card.classList.toggle("expanded", !detail.hidden);
      });
    } else {
      head.style.cursor = "default";
      chevron.hidden = true;
    }

    nightsEl.appendChild(card);
  }
}

/* ---------------------------------------------------- autocomplete */

let suggestions = [];      // resultados actuais do dropdown
let highlighted = -1;      // índice seleccionado por teclado
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

  if (!results.length) {
    closeSuggestions();
    return;
  }

  results.forEach((r, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");

    const main = document.createElement("span");
    main.className = "sug-name";
    main.textContent = r.name;

    const sub = document.createElement("span");
    sub.className = "sug-sub";
    sub.textContent = [r.admin1, r.country].filter(Boolean).join(" · ");

    li.append(main, sub);
    // mousedown corre antes do blur do input, senão a lista fecha primeiro.
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      chooseSuggestion(i);
    });
    li.addEventListener("mouseenter", () => setHighlight(i));
    suggestionsEl.appendChild(li);
  });

  suggestionsEl.hidden = false;
  placeInput.setAttribute("aria-expanded", "true");
}

placeInput.addEventListener("input", () => {
  const q = placeInput.value.trim();
  clearTimeout(debounceTimer);
  if (q.length < 2) {
    closeSuggestions();
    return;
  }
  // Espera que pare de escrever, para não disparar um pedido por tecla.
  debounceTimer = setTimeout(async () => {
    lastQuery = q;
    try {
      const results = await geocodeMany(q);
      if (lastQuery === q) renderSuggestions(results);  // ignora respostas fora de ordem
    } catch {
      closeSuggestions();
    }
  }, 250);
});

placeInput.addEventListener("keydown", (e) => {
  if (suggestionsEl.hidden) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setHighlight((highlighted + 1) % suggestions.length);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setHighlight((highlighted - 1 + suggestions.length) % suggestions.length);
  } else if (e.key === "Enter" && highlighted >= 0) {
    e.preventDefault();
    chooseSuggestion(highlighted);
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
});

placeInput.addEventListener("blur", () => setTimeout(closeSuggestions, 120));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (highlighted >= 0) {          // Enter com sugestão activa escolhe-a
    chooseSuggestion(highlighted);
    return;
  }
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
      current = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        label: "a tua localização",
      };
      loadForecast();
    },
    () => setStatus("⚠️ Não foi possível obter a localização."),
  );
});

/* ------------------------------------------------- locais guardados */

const SAVED_KEY = "astrowe.places";

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
  } catch {
    return [];
  }
}

function storeSaved(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* ignorar */ }
  renderSaved();
}

function renderSaved() {
  const list = loadSaved();
  savedListEl.innerHTML = "";
  for (const p of list) {
    const chip = document.createElement("span");
    chip.className = "saved-chip";

    const go = document.createElement("button");
    go.type = "button";
    go.className = "saved-go";
    go.textContent = p.name;
    go.title = `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
    go.addEventListener("click", () => {
      current = { lat: p.lat, lon: p.lon, label: p.name };
      placeInput.value = p.name;
      loadForecast();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "saved-del";
    del.textContent = "✕";
    del.title = `Esquecer ${p.name}`;
    del.addEventListener("click", () => {
      storeSaved(loadSaved().filter((x) => x.name !== p.name));
    });

    chip.append(go, del);
    savedListEl.appendChild(chip);
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

/* ------------------------------------------------ comparar locais */

function compareCellClass(score) {
  if (score >= 55) return "cmp-good";
  if (score >= 35) return "cmp-ok";
  return "cmp-poor";
}

async function openCompare() {
  const places = loadSaved();
  if (places.length < 2) return;

  compareModal.hidden = false;
  compareBody.innerHTML = '<p class="cmp-status">A calcular…</p>';

  const results = await Promise.all(places.map(async (p) => {
    try {
      const res = await fetch(`/api/forecast?lat=${p.lat}&lon=${p.lon}&mode=${mode}`);
      if (!res.ok) return { place: p, error: true };
      return { place: p, data: await res.json() };
    } catch {
      return { place: p, error: true };
    }
  }));

  const ok = results.filter((r) => !r.error);
  if (!ok.length) {
    compareBody.innerHTML = '<p class="cmp-status">Não foi possível calcular.</p>';
    return;
  }

  const dates = ok[0].data.nights.map((n) => n.date);
  // O melhor par (local, noite) de todos — a resposta a "onde e quando vou?"
  let best = { score: -1 };
  for (const r of ok) {
    for (const n of r.data.nights) {
      if (n.score > best.score) best = { score: n.score, place: r.place.name, night: n };
    }
  }

  const table = document.createElement("table");
  table.className = "cmp-table";

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.appendChild(document.createElement("th"));
  for (const d of dates) {
    const th = document.createElement("th");
    const dt = new Date(d + "T12:00:00");
    th.textContent = dt.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric" });
    hr.appendChild(th);
  }
  thead.appendChild(hr);

  const tbody = document.createElement("tbody");
  for (const r of ok) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.className = "cmp-place";
    const lp = r.data.light_pollution;
    th.innerHTML = `${r.place.name}<span>${lp ? lp.description : "poluição luminosa desconhecida"}</span>`;
    tr.appendChild(th);
    for (const n of r.data.nights) {
      const td = document.createElement("td");
      td.className = compareCellClass(n.score);
      if (r.place.name === best.place && n.date === best.night.date) td.classList.add("cmp-best");
      td.textContent = n.score;
      td.title = n.details;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);

  const verdict = document.createElement("p");
  verdict.className = "cmp-verdict";
  const bd = new Date(best.night.date + "T12:00:00");
  verdict.textContent =
    `Melhor combinação: ${best.place}, ${bd.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "short" })}` +
    ` — score ${best.score}. ${best.night.details}`;

  compareBody.innerHTML = "";
  compareBody.append(verdict, table);
}

compareBtn.addEventListener("click", openCompare);
compareClose.addEventListener("click", () => { compareModal.hidden = true; });
compareModal.addEventListener("click", (e) => {
  if (e.target === compareModal) compareModal.hidden = true;
});

/* ---------------------------------------------------------- mapa */

let map = null;
let marker = null;
let picked = null;   // { lat, lon }

function initMap() {
  // Leaflet só mede bem o contentor depois de ele estar visível, por isso
  // o mapa é criado à primeira abertura do modal, não no arranque.
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
    mapCoords.textContent =
      `${picked.lat.toFixed(4)}, ${picked.lon.toFixed(4)}`;
    mapConfirm.disabled = false;
  });
}

function openMap() {
  mapModal.hidden = false;
  if (!map) initMap();
  // O contentor acabou de ficar visível: forçar o Leaflet a remedir.
  setTimeout(() => map.invalidateSize(), 50);
  if (current) map.setView([current.lat, current.lon], 10);
}

function closeMap() {
  mapModal.hidden = true;
}

mapBtn.addEventListener("click", openMap);
mapClose.addEventListener("click", closeMap);
mapModal.addEventListener("click", (e) => {
  if (e.target === mapModal) closeMap();   // clicar fora fecha
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !mapModal.hidden) closeMap();
});

mapConfirm.addEventListener("click", () => {
  if (!picked) return;
  current = {
    lat: picked.lat,
    lon: picked.lon,
    label: `${picked.lat.toFixed(4)}, ${picked.lon.toFixed(4)}`,
  };
  placeInput.value = current.label;
  closeMap();
  loadForecast();
});

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.mode === mode) return;
    mode = btn.dataset.mode;
    modeBtns.forEach((b) => b.classList.toggle("active", b === btn));
    loadForecast();
  });
});

renderSaved();
