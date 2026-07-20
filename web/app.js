"use strict";

const form = document.getElementById("search-form");
const placeInput = document.getElementById("place");
const geoBtn = document.getElementById("geo-btn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
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

function render(data) {
  summaryEl.hidden = false;
  summaryEl.textContent = data.summary;

  for (const n of data.nights) {
    const hasWindow = n.window_start !== null;
    const card = document.createElement("article");
    card.className = "night";

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
    card.append(badge, body);
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
