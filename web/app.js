"use strict";

const form = document.getElementById("search-form");
const placeInput = document.getElementById("place");
const geoBtn = document.getElementById("geo-btn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const nightsEl = document.getElementById("nights");

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";

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

async function loadForecast(lat, lon, label) {
  setStatus(`A calcular as noites para ${label}…`);
  summaryEl.hidden = true;
  nightsEl.innerHTML = "";
  try {
    const res = await fetch(`/api/forecast?lat=${lat}&lon=${lon}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Erro ${res.status}`);
    }
    const data = await res.json();
    render(data, label);
    setStatus("");
  } catch (e) {
    setStatus(`⚠️ ${e.message}`);
  }
}

function scoreClass(score, isNight) {
  if (!isNight) return "score-none";
  if (score >= 55) return "score-good";
  if (score >= 35) return "score-ok";
  return "score-poor";
}

function render(data, label) {
  summaryEl.hidden = false;
  summaryEl.textContent = data.summary;

  for (const n of data.nights) {
    const isNight = n.dark_start !== null;
    const card = document.createElement("article");
    card.className = "night";

    const badge = document.createElement("div");
    badge.className = `score-badge ${scoreClass(n.score, isNight)}`;
    badge.textContent = isNight ? n.score : "—";

    const body = document.createElement("div");
    body.className = "night-body";

    const weekday = new Date(n.date + "T12:00:00").toLocaleDateString("pt-PT", {
      weekday: "long", day: "numeric", month: "short",
    });

    body.innerHTML = `
      <h3>${weekday}</h3>
      <div class="verdict">${n.verdict}${isNight ? ` · transparência ${n.transparency}` : ""}</div>
      <p class="details">${n.details}</p>
    `;

    card.appendChild(badge);
    card.appendChild(body);
    nightsEl.appendChild(card);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = placeInput.value.trim();
  if (!name) return;
  setStatus("A procurar localidade…");
  try {
    const { lat, lon, label } = await geocode(name);
    await loadForecast(lat, lon, label);
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
    (pos) => loadForecast(pos.coords.latitude, pos.coords.longitude, "a tua localização"),
    () => setStatus("⚠️ Não foi possível obter a localização."),
  );
});
