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
  $("#login").hidden = true;
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

    const rain = d.precip && d.precip.value > 0 ? `${d.precip.value}″ rain` : "";
    const wind = d.wind ? `Wind ${d.wind.value} mph` : "Wind —";
    const gust = d.gust ? `gusts ${d.gust.value}` : "";

    const cond = dayCondition(d);
    const row = el("div", { class: "day-row", role: "button", tabindex: "0", "aria-expanded": "false" },
      el("div", { class: "when" }, name, el("small", {}, date)),
      el("div", { class: "day-cond" }, icon(cond.icon, 34, cond.text),
        el("span", { class: (d.rain_prob ?? 0) >= 20 ? "drop" : "drop dim" }, d.rain_prob == null ? "" : `${d.rain_prob}%`)),
      el("div", { class: "temps" },
        el("span", { class: "lo", title: `Low, model range ${fmtRange(d.tmin, "°")}` }, tmin == null ? "—" : `${tmin}°`),
        el("div", { class: "bar", "aria-hidden": "true" }, el("span", { style: `left:${left}%;width:${Math.max(width, 2)}%` })),
        el("span", { class: "hi", title: `High, model range ${fmtRange(d.tmax, "°")}` }, tmax == null ? "—" : `${tmax}°`),
      ),
      el("div", { class: "details" },
        rain ? el("span", { class: d.rain_prob >= 30 ? "rain" : "" }, rain) : null,
        el("span", {}, [wind, gust].filter(Boolean).join(", ")),
        d.tmax && d.tmax.low !== d.tmax.high ? el("span", { class: "range" }, `high ${fmtRange(d.tmax, "°")}`) : null,
      ),
      d.hours || d.detail ? el("span", { class: "chev", "aria-hidden": "true" }, "▾") : null,
    );
    const li = el("li", { class: "day" }, row);
    if (d.hours || d.detail) {
      const panel = dayPanel(d);
      panel.hidden = true;
      li.append(panel);
      const toggle = () => {
        panel.hidden = !panel.hidden;
        row.setAttribute("aria-expanded", String(!panel.hidden));
        li.classList.toggle("open", !panel.hidden);
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    }
    return li;
  }));
}

const KIND_LABEL = { thunderstorms: "T-storms", "freezing rain": "Frz rain", snow: "Snow", rain: "Rain", drizzle: "Drizzle" };

function dayFacts(x) {
  const facts = [];
  const kind = x.precip_type || "rain";
  const Kind = kind[0].toUpperCase() + kind.slice(1);
  if (x.rain_windows?.length) facts.push([`${Kind} likely ${x.rain_windows.join(", ")}`, kind === "thunderstorms" ? "storm" : "wet"]);
  if (x.rain_possible?.length) facts.push([`${Kind} possible ${x.rain_possible.join(", ")}`, ""]);
  if (x.thunder && x.precip_type !== "thunderstorms") facts.push(["Thunder risk", "storm"]);
  if (x.wind_from) facts.push([`Wind from ${x.wind_from}` + (x.gust_peak_time ? ` · gusts peak ~${x.gust_peak_time}` : ""), ""]);
  if (x.sky) facts.push([x.sky, ""]);
  if (x.humidity_min != null) facts.push([`Humidity ${x.humidity_min}–${x.humidity_max}%`, ""]);
  if (x.feels_min != null) facts.push([`Feels like ${x.feels_min}–${x.feels_max}°`, ""]);
  if (x.sunrise) facts.push([`Sunrise ${x.sunrise} · Sunset ${x.sunset}`, ""]);
  return el("ul", { class: "facts" }, ...facts.map(([t, c]) => el("li", { class: c }, t)));
}

function hoursTable(h) {
  const rows = h.rows;
  const cell = (r, text, cls = "") => el("td", { class: cls }, text ?? "—");
  const line = (label, fn) => el("tr", {}, el("th", { scope: "row" }, label), ...rows.map(fn));
  return el("div", { class: "hours" }, el("table", {},
    el("thead", {}, el("tr", {}, el("th", { scope: "row" }, ""), ...rows.map((r) => el("th", { scope: "col" }, r.label)))),
    el("tbody", {},
      line("Temp", (r) => cell(r, r.temp == null ? null : `${r.temp}°`)),
      line("Feels", (r) => cell(r, r.feels == null ? null : `${r.feels}°`)),
      line("Rain %", (r) => cell(r, r.rain_prob == null ? null : `${r.rain_prob}%`, r.rain_prob >= 40 ? "wet" : "")),
      line("Rain in", (r) => cell(r, r.precip ? `${r.precip}″` : "0", r.precip >= 0.01 ? "wet" : "")),
      line("Sky", (r) => cell(r, r.kind ? KIND_LABEL[r.kind] || r.kind : r.sky, r.kind === "thunderstorms" ? "storm" : r.kind ? "wet" : "")),
      line("Wind", (r) => cell(r, r.wind == null ? null : `${r.wind_from || ""} ${r.wind}`.trim())),
      line("Gusts", (r) => cell(r, r.gust)),
      line("Humidity", (r) => cell(r, r.humidity == null ? null : `${r.humidity}%`)),
    ),
  ));
}

function dayPanel(d) {
  const panel = el("div", { class: "day-panel" });
  if (d.detail) panel.append(dayFacts(d.detail));
  if (d.hours) {
    panel.append(hoursTable(d.hours));
    panel.append(el("p", { class: "muted small hours-note" },
      d.hours.step_hours === 1 ? "Hourly. Wind and gusts in mph; scroll sideways for more hours."
        : "Every 3 hours (rain is the 3-hour total, chance is the highest in the block). Scroll sideways."));
  }
  return panel;
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

let lastData = null;

async function summarize() {
  const btn = $("#summary-btn"), box = $("#summary");
  btn.disabled = true;
  box.hidden = false;
  box.textContent = "Writing a summary…";
  try {
    const res = await apiFetch("api/summary", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lastData),
    });
    const out = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
    if (!res.ok) throw new Error(out.error || `Server error (${res.status})`);
    box.replaceChildren(out.summary, el("span", { class: "muted small" }, "Written by Claude from the forecast numbers above."));
  } catch (err) {
    if (err.loginRequired) { box.hidden = true; showLogin(summarize); return; }
    box.textContent = `Summary unavailable: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function render(data) {
  lastData = data;
  $("#summary").hidden = true;
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
  show("result");  // charts measure their container, so it must be visible first
  renderHero(data);
  renderStrip(data);
  renderCharts(data);
  renderDays(data.days);
  renderCalibration(data.calibration);
  $("#notes").replaceChildren(...data.notes.map((n) => el("li", {}, n)));
  $("#attribution").textContent = data.attribution;
  show("result");
}

// --- fetching ---------------------------------------------------------------

// --- login (only when the server has a password set) -------------------------

let afterLogin = null;

function showLogin(retry) {
  afterLogin = retry;
  for (const s of ["loading", "error", "result"]) $("#" + s).hidden = true;
  $("#login").hidden = false;
  $("#login-error").hidden = true;
  $("#password").focus();
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.login_required) {
      const err = new Error("login required");
      err.loginRequired = true;
      throw err;
    }
  }
  return res;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await fetch("api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: $("#password").value }),
  }).catch(() => null);
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    $("#login-error").textContent = body.error || "Can't reach the server.";
    $("#login-error").hidden = false;
    return;
  }
  $("#password").value = "";
  $("#login").hidden = true;
  const retry = afterLogin;
  afterLogin = null;
  if (retry) retry();
});

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
    const res = await apiFetch("api/forecast?" + new URLSearchParams(params), { signal: ctrl.signal });
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
    if (err.loginRequired) { showLogin(() => forecast(params)); return; }
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

$("#summary-btn").addEventListener("click", summarize);
fetch("api/config").then((r) => r.json()).then((c) => { $("#ai-box").hidden = !c.ai; }).catch(() => {});

renderRecent();
const initial = Object.fromEntries(new URLSearchParams(location.search));
if (initial.place || (initial.lat && initial.lon)) {
  if (initial.place) $("#place").value = initial.place === "My location" ? "" : initial.place;
  forecast(initial);
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
