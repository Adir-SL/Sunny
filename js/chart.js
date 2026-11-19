/** SVG charts for the hourly temperature, precipitation, and wind tabs. */

import { escapeHtml, formatHourLabel, speedNumber, tempNumber } from "./format.js";

export function renderChart({ hours, mode, unit, selectedIndex }) {
  const width = 720;
  const height = 196;
  const pad = { l: 44, r: 12, t: 16, b: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const count = Math.max(hours.length, 2);
  const xAt = (index) => pad.l + (index + 0.5) * (innerW / count);

  const series = hours.map((hour) => {
    if (mode === "precip") return Number(hour?.precipitation?.probability?.percent) || 0;
    if (mode === "wind") return speedNumber(hour?.wind?.speed?.value, unit) ?? 0;
    return tempNumber(hour?.temperature?.degrees, unit) ?? 0;
  });

  let min = Math.min(...series);
  let max = Math.max(...series);
  if (mode === "precip") {
    min = 0;
    max = 100;
  } else if (max - min < 4) {
    min -= 2;
    max += 2;
  } else {
    const padValue = (max - min) * 0.18;
    min -= padValue;
    max += padValue;
  }
  if (mode === "wind") min = 0;

  const yAt = (value) => pad.t + ((max - value) / (max - min || 1)) * innerH;
  const ticks = mode === "precip" ? [0, 30, 60, 100] : [min, (min + max) / 2, max];
  const tickLabels = ticks.map((tick) => {
    if (mode === "precip") return `${Math.round(tick)}%`;
    return `${Math.round(tick)}${mode === "temp" ? "°" : ""}`;
  });

  const coords = series.map((value, index) => [xAt(index), yAt(value)]);
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(" ");
  const baseline = yAt(mode === "precip" || mode === "wind" ? 0 : min);
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${baseline.toFixed(1)} L${coords[0][0].toFixed(1)} ${baseline.toFixed(1)} Z`;

  const grid = ticks.map((tick, index) => {
    const y = yAt(tick);
    return `<line class="grid" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${width - pad.r}" y2="${y.toFixed(1)}" ${mode === "precip" && Math.round(tick) === 30 ? 'data-threshold="true"' : ""}></line>
      <text class="tick" x="${pad.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${escapeHtml(tickLabels[index])}</text>`;
  }).join("");

  let marks = "";
  if (mode === "temp") {
    marks = `<path class="area" d="${area}"></path><path class="line" d="${line}"></path>` +
      coords.map((point, index) => `<circle class="dot${index === selectedIndex ? " is-selected" : ""}" cx="${point[0].toFixed(1)}" cy="${point[1].toFixed(1)}" r="${index === selectedIndex ? 4.5 : 2.4}"></circle>`).join("");
  } else if (mode === "precip") {
    const barW = Math.min(18, (innerW / count) * 0.62);
    marks = coords.map((point, index) => {
      const y = point[1];
      const h = Math.max(0, baseline - y);
      return `<rect class="bar${series[index] > 30 ? " is-wet" : ""}" x="${(point[0] - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"></rect>`;
    }).join("");
  } else {
    marks = coords.map((point, index) => {
      const degrees = Number(hours[index]?.wind?.direction?.degrees) || 0;
      return `<g class="wind-mark" transform="translate(${point[0].toFixed(1)} ${point[1].toFixed(1)}) rotate(${degrees})">
        <line y1="6" y2="-7"></line><polyline points="-3.2,-2 0,-7 3.2,-2"></polyline></g>`;
    }).join("") + `<path class="line line-wind" d="${line}"></path>`;
  }

  const labels = hours.map((hour, index) => {
    if (index % 3 !== 0 && index !== hours.length - 1) return "";
    return `<text class="tick x" x="${xAt(index).toFixed(1)}" y="${height - 8}" text-anchor="middle">${escapeHtml(formatHourLabel(hour))}</text>`;
  }).join("");

  const selectedX = xAt(Math.min(selectedIndex, hours.length - 1));
  const hits = hours.map((_, index) => {
    const slot = innerW / count;
    return `<rect class="hit" data-hour="${index}" x="${(xAt(index) - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height}"></rect>`;
  }).join("");

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">
    ${grid}
    <line class="marker" x1="${selectedX.toFixed(1)}" y1="${pad.t}" x2="${selectedX.toFixed(1)}" y2="${height - pad.b}"></line>
    ${marks}
    ${labels}
    ${hits}
  </svg>`;
}
