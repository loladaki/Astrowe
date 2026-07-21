"use strict";

const form = document.getElementById("search-form");
const placeInput = document.getElementById("place");
const geoBtn = document.getElementById("geo-btn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const siteEl = document.getElementById("site");
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

async function geocode(name) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=1&language=pt&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Falha na geocodificação");
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`Localidade "${name}" não encontrada`);
  }
  const r = data.results[0];
  return { lat: r.latitude, lon: r.longitude, label: `${r.name}, ${r.country_code}` };
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
    siteEl.textContent =
      `🔦 Bortle ${lp.bortle} · SQM ${lp.sqm} mag/arcsec² — já incluído no score.`;
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

  detail.appendChild(buildHourStrip(n.hours));

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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = placeInput.value.trim();
  if (!name) return;
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

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.mode === mode) return;
    mode = btn.dataset.mode;
    modeBtns.forEach((b) => b.classList.toggle("active", b === btn));
    loadForecast();
  });
});
