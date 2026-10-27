"use strict";

const $ = (sel) => document.querySelector(sel);
const RECENT_KEY = "weather-engine:recent";
const TIMEOUT_MS = 90_000;

// --- small helpers ---------------------------------------------------------

function storageGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}
function show(id) {
  for (const s of ["loading", "error", "result"]) $("#" + s).hidden = s !== id;
}
function fmtRange(cell, unit = "") {
  if (!cell) return "—";
  return cell.low !== cell.high ? `${cell.low}–${cell.high}${unit}` : "";
}
function dayLabel(iso, lead) {
  const d = new Date(iso + "T12:00:00");
  const name = lead === 0 ? "Today" : lead === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "long" });
  return [name, d.toLocaleDateString(undefined, { month: "short", day: "numeric" })];
}

// --- recent places ----------------------------------------------------------

function renderRecent() {
  const box = $("#recent");
  box.replaceChildren(...storageGet(RECENT_KEY, []).map((p) => {
    const b = el("button", { type: "button", class: "chip" }, p);
    b.addEventListener("click", () => { $("#place").value = p; forecast({ place: p }); });
    return b;
  }));
}
function remember(place) {
  const list = [place, ...storageGet(RECENT_KEY, []).filter((p) => p !== place)].slice(0, 5);
  storageSet(RECENT_KEY, list);
  renderRecent();
}

// --- rendering --------------------------------------------------------------

function renderDays(days) {
  const temps = days.flatMap((d) => [d.tmin?.value, d.tmax?.value]).filter((v) => v != null);
  const lo = Math.min(...temps), hi = Math.max(...temps), span = Math.max(hi - lo, 1);

  $("#days").replaceChildren(...days.map((d) => {
    const [name, date] = dayLabel(d.date, d.lead);
    const tmin = d.tmin?.value, tmax = d.tmax?.value;
    const left = tmin == null ? 0 : ((tmin - lo) / span) * 100;
    const width = tmin == null || tmax == null ? 0 : ((tmax - tmin) / span) * 100;

    const rainAmt = d.precip && d.precip.value > 0 ? ` · ${d.precip.value}″` : "";
    const rain = d.rain_prob == null ? "Rain —" : `Rain ${d.rain_prob}%${rainAmt}`;
    const wind = d.wind ? `Wind ${d.wind.value} mph` : "Wind —";
    const gust = d.gust ? `gusts ${d.gust.value}` : "";

    return el("li", { class: "day" },
      el("div", { class: "when" }, name, el("small", {}, date)),
      el("div", { class: "temps" },
        el("span", { class: "lo", title: `Low, model range ${fmtRange(d.tmin, "°")}` }, tmin == null ? "—" : `${tmin}°`),
        el("div", { class: "bar", "aria-hidden": "true" }, el("span", { style: `left:${left}%;width:${Math.max(width, 2)}%` })),
        el("span", { class: "hi", title: `High, model range ${fmtRange(d.tmax, "°")}` }, tmax == null ? "—" : `${tmax}°`),
      ),
      el("div", { class: "details" },
        el("span", { class: d.rain_prob >= 30 ? "rain" : "" }, rain),
        el("span", {}, [wind, gust].filter(Boolean).join(", ")),
        d.tmax && d.tmax.low !== d.tmax.high ? el("span", { class: "range" }, `high ${fmtRange(d.tmax, "°")}`) : null,
      ),
    );
  }));
}

function renderCalibration(rows) {
  const box = $("#calibration");
  box.hidden = rows.length === 0;
  box.querySelector("tbody").replaceChildren(...rows.map((r) =>
    el("tr", {},
      el("td", {}, r.label),
      el("td", {}, r.shift),
      el("td", {}, `${r.error_before} → ${r.error_after} ${r.unit}`),
    )));
}

function renderOverride(data) {
  const box = $("#override");
  box.hidden = !(data.station_rejected && data.station);
  if (box.hidden) return;
  const s = data.station;
  $("#override-text").textContent =
    `No weather station passed the closeness check (the nearest, ${s.name} (${s.id}), is ` +
    `${Math.round(s.distance_km)} km away), so this forecast ` +
    `isn't corrected for local conditions. Calibrating against it anyway usually still helps in flat, open ` +
    `areas, but can mislead across mountains, coastlines or big elevation changes.`;
  $("#override-btn").textContent = `Calibrate against ${s.id} anyway`;
  $("#override-btn").onclick = () => forecast({ ...lastParams, station: s.id });
}

function render(data) {
  $("#loc-name").textContent = data.location.name;
  const pill = $("#status");
  if (data.calibrated) {
    pill.className = "pill ok";
    pill.textContent = "Calibrated";
    pill.title = data.status;
  } else {
    pill.className = "pill warn";
    pill.textContent = "Uncalibrated";
    pill.title = data.status;
  }
  const issued = new Date(data.issued_at);
  const byStation = new Map();
  for (const s of data.stations || []) {
    const k = `${s.name} (${Math.round(s.distance_km)} km)`;
    byStation.set(k, [...(byStation.get(k) || []), s.label]);
  }
  const where = byStation.size
    ? " · checked against " + [...byStation].map(([k, labels]) => `${k} for ${labels.join(" & ")}`).join("; ")
    : "";
  $("#issued").textContent = `Updated ${issued.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}${where}`;
  renderOverride(data);
  renderDays(data.days);
  renderCalibration(data.calibration);
  $("#notes").replaceChildren(...data.notes.map((n) => el("li", {}, n)));
  $("#attribution").textContent = data.attribution;
  show("result");
}

// --- fetching ---------------------------------------------------------------

let inFlight = null;
let lastParams = {};

async function forecast(params) {
  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;
  const timer = setTimeout(() => ctrl.abort("timeout"), TIMEOUT_MS);
  show("loading");
  $("#search button").disabled = true;
  try {
    const res = await fetch("api/forecast?" + new URLSearchParams(params), { signal: ctrl.signal });
    const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
    lastParams = params;
    render(data);
    if (params.place) remember(params.place);
    const url = new URL(location.href);
    url.search = new URLSearchParams(params);
    history.replaceState(null, "", url);
  } catch (err) {
    if (ctrl.signal.aborted && ctrl.signal.reason !== "timeout") return; // superseded by a newer search
    const msg = ctrl.signal.reason === "timeout"
      ? "That took too long. The weather services may be slow; please try again."
      : err instanceof TypeError
        ? "Can't reach the Weather Engine server. Is `weather-engine serve` still running?"
        : err.message;
    $("#error").textContent = msg;
    show("error");
  } finally {
    clearTimeout(timer);
    if (inFlight === ctrl) $("#search button").disabled = false;
  }
}

// --- wiring -----------------------------------------------------------------

$("#search").addEventListener("submit", (e) => {
  e.preventDefault();
  const place = $("#place").value.trim();
  if (place) forecast({ place });
});

$("#locate").addEventListener("click", () => {
  if (!navigator.geolocation) {
    $("#error").textContent = "Location isn't available in this browser.";
    show("error");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => forecast({
      place: "My location",
      lat: pos.coords.latitude.toFixed(4),
      lon: pos.coords.longitude.toFixed(4),
    }),
    () => {
      $("#error").textContent = "Couldn't get your location. Over plain Wi-Fi (http) phones block it; type a place instead.";
      show("error");
    },
    { timeout: 15000 },
  );
});

renderRecent();
const initial = Object.fromEntries(new URLSearchParams(location.search));
if (initial.place || (initial.lat && initial.lon)) {
  if (initial.place) $("#place").value = initial.place === "My location" ? "" : initial.place;
  forecast(initial);
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
