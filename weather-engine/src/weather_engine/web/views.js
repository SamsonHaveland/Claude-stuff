"use strict";
// Visual pieces of the forecast screen: weather icons, the "now" hero card,
// the hourly strip and the 48-hour temperature / rain-chance charts.
// Depends on el() and dayLabel() from app.js (loaded after this file, used at call time).

// --- icons -----------------------------------------------------------------

const ICON_PATHS = {
  sun: `<circle class="i-sun" cx="12" cy="12" r="4.5"/><g class="i-ray">${[0, 45, 90, 135, 180, 225, 270, 315]
    .map((a) => `<line x1="12" y1="2.5" x2="12" y2="5" transform="rotate(${a} 12 12)"/>`).join("")}</g>`,
  moon: `<path class="i-moon" d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z"/>`,
  cloud: `<path class="i-cloud" d="M7 19h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.5 10.2 4.5 4.5 0 0 0 7 19z"/>`,
};
const SMALL_SUN = `<g transform="translate(-3 -4) scale(.75)">${ICON_PATHS.sun}</g>`;
const SMALL_MOON = `<g transform="translate(-2 -3) scale(.7)">${ICON_PATHS.moon}</g>`;
const CLOUD_HIGH = `<g transform="translate(0 -3)">${ICON_PATHS.cloud}</g>`;
const drops = (cls, xs) => xs.map((x) => `<line class="${cls}" x1="${x}" y1="18.5" x2="${x - 1.5}" y2="22"/>`).join("");
const ICONS = {
  "clear-day": ICON_PATHS.sun,
  "clear-night": ICON_PATHS.moon,
  "partly-day": SMALL_SUN + ICON_PATHS.cloud,
  "partly-night": SMALL_MOON + ICON_PATHS.cloud,
  cloudy: ICON_PATHS.cloud,
  rain: CLOUD_HIGH + drops("i-rain", [8, 12, 16]),
  drizzle: CLOUD_HIGH + [8, 12, 16].map((x) => `<circle class="i-rain-dot" cx="${x - 1}" cy="20" r="1"/>`).join(""),
  storm: CLOUD_HIGH + `<path class="i-bolt" d="M12.5 15l-3 4.5h2.5l-1 4 3.8-5.3h-2.6l1.3-3.2z"/>`,
  snow: CLOUD_HIGH + [8, 12, 16].map((x) => `<circle class="i-snow" cx="${x - 1}" cy="20.5" r="1.3"/>`).join(""),
  sleet: CLOUD_HIGH + drops("i-rain", [8, 16]) + `<circle class="i-snow" cx="11" cy="20.5" r="1.3"/>`,
};

function icon(name, size = 28, label = "") {
  const span = el("span", { class: "wx-icon", style: `width:${size}px;height:${size}px` });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${ICONS[name] || ICONS.cloudy}</svg>`;
  return span;
}

// --- conditions --------------------------------------------------------------

const KIND_ICON = { thunderstorms: "storm", snow: "snow", "freezing rain": "sleet", drizzle: "drizzle", rain: "rain" };
const KIND_TEXT = { thunderstorms: "Thunderstorms", snow: "Snow", "freezing rain": "Freezing rain", drizzle: "Drizzle", rain: "Rain" };

function minutesOf(label) {  // "6:12 am" -> minutes after midnight
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(label || "");
  if (!m) return null;
  return ((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)) * 60 + Number(m[2]);
}

function isNight(timeIso, detail) {
  const t = new Date(timeIso);
  const mins = t.getHours() * 60 + t.getMinutes();
  const rise = minutesOf(detail?.sunrise) ?? 6 * 60;
  const set = minutesOf(detail?.sunset) ?? 19 * 60;
  return mins < rise || mins >= set;
}

/** Icon + words for an hour row; precipitation only when it's reasonably likely. */
function hourCondition(row, night) {
  const wet = row.kind && ((row.rain_prob ?? 0) >= 30 || (row.precip ?? 0) >= 0.01);
  if (wet) return { icon: KIND_ICON[row.kind] || "rain", text: KIND_TEXT[row.kind] || "Rain" };
  return skyCondition(row.sky, night);
}

function skyCondition(sky, night) {
  switch (sky) {
    case "Clear": return { icon: night ? "clear-night" : "clear-day", text: night ? "Clear" : "Sunny" };
    case "Mostly clear": return { icon: night ? "partly-night" : "partly-day", text: night ? "Mostly clear" : "Mostly sunny" };
    case "Partly cloudy": return { icon: night ? "partly-night" : "partly-day", text: "Partly cloudy" };
    case "Mostly cloudy": return { icon: "cloudy", text: "Mostly cloudy" };
    case "Overcast": return { icon: "cloudy", text: "Cloudy" };
    default: return { icon: night ? "partly-night" : "partly-day", text: "" };
  }
}

/** Icon + words for a whole day: rain type when it's likely, otherwise the day's sky. */
function dayCondition(d) {
  const x = d.detail || {};
  if ((d.rain_prob ?? 0) >= 40 || x.rain_windows?.length) {
    const kind = x.precip_type || "rain";
    return { icon: KIND_ICON[kind] || "rain", text: KIND_TEXT[kind] || "Rain" };
  }
  if (x.thunder && (d.rain_prob ?? 0) >= 20) return { icon: "storm", text: "Chance of storms" };
  return skyCondition(x.sky, false);
}

// --- hero ("right now") ------------------------------------------------------

function heroStat(label, value, sub) {
  return el("div", { class: "stat" },
    el("span", { class: "stat-label" }, label),
    el("span", { class: "stat-value" }, value),
    sub ? el("span", { class: "stat-sub" }, sub) : null);
}

function renderHero(data) {
  const today = data.days[0];
  const now = today?.hours?.rows?.[0];
  const x = today?.detail || {};
  const night = now ? isNight(now.time, x) : false;
  const cond = now ? hourCondition(now, night) : dayCondition(today);
  const box = $("#hero-main");
  box.dataset.mood = cond.icon.startsWith("clear") || cond.icon.startsWith("partly")
    ? (night ? "night" : "sunny") : ["rain", "drizzle", "storm", "sleet", "snow"].includes(cond.icon) ? "wet" : "cloudy";

  const temp = now?.temp ?? today?.tmax?.value;
  const hi = today?.tmax?.value, lo = today?.tmin?.value;
  const rainLine = x.rain_windows?.length
    ? `${KIND_TEXT[x.precip_type] || "Rain"} likely ${x.rain_windows.join(", ")}`
    : x.rain_possible?.length ? `${KIND_TEXT[x.precip_type] || "Rain"} possible ${x.rain_possible.join(", ")}` : "";

  box.replaceChildren(...[
    el("div", { class: "hero-top" },
      el("div", {},
        el("div", { class: "hero-temp" }, temp == null ? "—" : `${temp}°`),
        el("div", { class: "hero-cond" }, cond.text || " "),
        el("div", { class: "hero-sub" },
          [now?.feels != null ? `Feels like ${now.feels}°` : null, hi != null ? `H ${hi}°` : null, lo != null ? `L ${lo}°` : null]
            .filter(Boolean).join("  ·  "))),
      icon(cond.icon, 84, cond.text)),
    rainLine ? el("p", { class: "hero-alert" }, rainLine) : null,
  ].filter(Boolean));

  const windNow = now?.wind != null ? `${now.wind_from || ""} ${now.wind} mph`.trim() : today?.wind ? `${today.wind.value} mph` : "—";
  const gustMax = today?.gust ? `Gusts ${today.gust.value} mph` + (x.gust_peak_time ? ` around ${x.gust_peak_time}` : "") : null;
  $("#hero-stats").replaceChildren(
    heroStat("Rain today", today?.rain_prob == null ? "—" : `${today.rain_prob}%`,
      today?.precip?.value > 0 ? `${today.precip.value}″ expected` : "No rain expected"),
    heroStat("Wind", windNow, gustMax),
    heroStat("Humidity", now?.humidity != null ? `${now.humidity}%` : "—",
      x.humidity_min != null ? `${x.humidity_min}–${x.humidity_max}% today` : null),
    heroStat("Sun", x.sunrise ? `↑ ${x.sunrise}` : "—", x.sunset ? `↓ ${x.sunset}` : null),
  );
}

// --- hourly strip ------------------------------------------------------------

function next48(data) {
  const rows = [];
  for (const d of data.days.slice(0, 3)) {
    if (!d.hours || d.hours.step_hours !== 1) continue;
    for (const r of d.hours.rows) rows.push({ ...r, detail: d.detail, date: d.date, lead: d.lead });
  }
  return rows.slice(0, 48);
}

function renderStrip(data) {
  const rows = next48(data);
  $("#hourly").hidden = rows.length === 0;
  const items = [];
  let lastDate = null;
  rows.forEach((r, i) => {
    if (r.date !== lastDate && i > 0) {
      items.push(el("li", { class: "hr-day", "aria-hidden": "true" }, dayLabel(r.date, r.lead)[0]));
    }
    lastDate = r.date;
    const night = isNight(r.time, r.detail);
    const cond = hourCondition(r, night);
    const rain = r.rain_prob ?? 0;
    items.push(el("li", { class: "hr" },
      el("span", { class: "hr-time" }, i === 0 ? "Now" : r.label),
      icon(cond.icon, 30, cond.text),
      el("span", { class: "hr-temp" }, r.temp == null ? "—" : `${r.temp}°`),
      el("span", { class: rain >= 20 ? "hr-rain" : "hr-rain dim" }, rain >= 10 ? `${rain}%` : " "),
      el("span", { class: "hr-wind" }, r.wind == null ? "" : `${r.wind_from || ""} ${r.wind}`.trim()),
    ));
  });
  $("#hourly-list").replaceChildren(...items);
}

// --- 48-hour charts ----------------------------------------------------------
// Two aligned charts (temperature °F, rain chance %) sharing one time axis and
// one crosshair: different units never share a y-axis.

const SVGNS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

let chartRows = [];

function renderCharts(data) {
  chartRows = next48(data).filter((r) => r.temp != null);
  $("#charts").hidden = chartRows.length < 6;
  if (!$("#charts").hidden) drawCharts();
}

function drawCharts() {
  const rows = chartRows;
  const wrap = $("#chart-area");
  const W = Math.max(wrap.clientWidth, 280);
  const pad = { l: 34, r: 10 };
  const TH = 150, RH = 70, GAP = 26, XH = 22;
  const H = TH + GAP + RH + XH;
  const iw = W - pad.l - pad.r;
  const x = (i) => pad.l + (rows.length === 1 ? iw / 2 : (i / (rows.length - 1)) * iw);

  const temps = rows.map((r) => r.temp);
  let tMin = Math.min(...temps), tMax = Math.max(...temps);
  const step = tMax - tMin > 30 ? 10 : 5;
  tMin = Math.floor((tMin - 2) / step) * step;
  tMax = Math.ceil((tMax + 2) / step) * step;
  const ty = (v) => 14 + (1 - (v - tMin) / (tMax - tMin)) * (TH - 24);
  const rTop = TH + GAP, ry = (p) => rTop + RH - (p / 100) * RH;

  const root = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img",
    "aria-label": `Next ${rows.length} hours: temperature from ${Math.min(...temps)}° to ${Math.max(...temps)}°, ` +
      `highest rain chance ${Math.max(...rows.map((r) => r.rain_prob ?? 0))}%. Hourly table is in each day's details.` });

  // Titles
  const title = (txt, y) => { const t = svg("text", { x: pad.l, y, class: "c-title" }); t.textContent = txt; root.append(t); };
  title("Temperature °F", 10);
  title("Chance of rain", rTop - 8);

  // Temperature grid + labels
  for (let v = tMin; v <= tMax; v += step) {
    root.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: ty(v), y2: ty(v), class: "c-grid" }));
    const t = svg("text", { x: pad.l - 6, y: ty(v) + 4, class: "c-axis", "text-anchor": "end" });
    t.textContent = `${v}°`;
    root.append(t);
  }
  // Rain grid (0 / 50 / 100%)
  for (const p of [0, 50, 100]) {
    root.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: ry(p), y2: ry(p), class: p === 0 ? "c-base" : "c-grid" }));
    const t = svg("text", { x: pad.l - 6, y: ry(p) + 4, class: "c-axis", "text-anchor": "end" });
    t.textContent = `${p}%`;
    root.append(t);
  }

  // Night shading behind both charts
  rows.forEach((r, i) => {
    if (!isNight(r.time, r.detail)) return;
    const half = iw / Math.max(rows.length - 1, 1) / 2;
    root.append(svg("rect", { x: x(i) - half, y: 14, width: half * 2, height: rTop + RH - 14, class: "c-night" }));
  });

  // Temperature area + 2px line
  const pts = rows.map((r, i) => `${x(i)},${ty(r.temp)}`);
  root.append(svg("path", { d: `M${x(0)},${ty(tMin)} L${pts.join(" L")} L${x(rows.length - 1)},${ty(tMin)} Z`, class: "c-area" }));
  root.append(svg("path", { d: `M${pts.join(" L")}`, class: "c-line" }));

  // Selective direct labels: the highest and lowest hour
  const iMax = temps.indexOf(Math.max(...temps)), iMin = temps.indexOf(Math.min(...temps));
  for (const [i, above] of [[iMax, true], [iMin, false]]) {
    root.append(svg("circle", { cx: x(i), cy: ty(temps[i]), r: 4, class: "c-dot" }));
    const t = svg("text", { x: Math.min(Math.max(x(i), pad.l + 14), W - pad.r - 14), y: ty(temps[i]) + (above ? -9 : 17),
      class: "c-label", "text-anchor": "middle" });
    t.textContent = `${temps[i]}°`;
    root.append(t);
  }

  // Rain-chance bars (2px gap, rounded ends anchored to the baseline)
  const bw = Math.max(iw / rows.length - 2, 2);
  rows.forEach((r, i) => {
    const p = r.rain_prob ?? 0;
    if (p <= 0) return;
    const h = Math.max(RH - (ry(p) - rTop), 2);
    root.append(svg("rect", { x: x(i) - bw / 2, y: rTop + RH - h, width: bw, height: h,
      rx: Math.min(2, bw / 2), class: p >= 40 ? "c-bar strong" : "c-bar" }));
  });

  // Time axis: every 6 hours, with day names at midnight
  rows.forEach((r, i) => {
    const hr = new Date(r.time).getHours();
    if (hr % 6 !== 0) return;
    const t = svg("text", { x: x(i), y: H - 6, class: hr === 0 ? "c-axis strong" : "c-axis", "text-anchor": "middle" });
    t.textContent = hr === 0 ? new Date(r.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" }) : r.label;
    root.append(t);
  });

  // Crosshair + hover/touch target (larger than the marks)
  const cross = svg("line", { y1: 14, y2: rTop + RH, class: "c-cross", visibility: "hidden" });
  const dot = svg("circle", { r: 5, class: "c-dot hover", visibility: "hidden" });
  const hit = svg("rect", { x: pad.l - 6, y: 0, width: iw + 12, height: rTop + RH + 4, class: "c-hit" });
  root.append(cross, dot, hit);

  const tip = $("#chart-tip");
  const showAt = (clientX) => {
    const box = root.getBoundingClientRect();
    const i = Math.round(((clientX - box.left - pad.l) / iw) * (rows.length - 1));
    const r = rows[Math.min(Math.max(i, 0), rows.length - 1)];
    const k = rows.indexOf(r);
    cross.setAttribute("x1", x(k)); cross.setAttribute("x2", x(k)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(k)); dot.setAttribute("cy", ty(r.temp)); dot.setAttribute("visibility", "visible");
    const cond = hourCondition(r, isNight(r.time, r.detail));
    tip.replaceChildren(
      el("strong", {}, `${dayLabel(r.date, r.lead)[0]} ${r.label}`),
      el("span", {}, `${r.temp}°  ·  feels ${r.feels ?? "—"}°  ·  ${cond.text}`),
      el("span", {}, `Rain ${r.rain_prob ?? 0}%${r.precip ? ` · ${r.precip}″` : ""}  ·  Wind ${r.wind_from || ""} ${r.wind ?? "—"} mph`),
    );
    tip.hidden = false;
    const left = Math.min(Math.max(x(k) - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
    tip.style.left = `${left}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  hit.addEventListener("pointermove", (e) => showAt(e.clientX));
  hit.addEventListener("pointerdown", (e) => showAt(e.clientX));
  hit.addEventListener("pointerleave", hide);

  wrap.replaceChildren(root);
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (chartRows.length && !$("#charts").hidden) drawCharts(); }, 150);
});
