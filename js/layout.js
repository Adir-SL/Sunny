/** Card order and visibility. Unknown saved ids are dropped; new ids keep their default slot. */

export const DEFAULT_SECTIONS = [
  { id: "current", label: "Current conditions" },
  { id: "rain", label: "Rain warning" },
  { id: "alerts", label: "Alerts" },
  { id: "hourly", label: "Hourly" },
  { id: "daily", label: "10-day forecast" },
  { id: "details", label: "Details" },
];

export const LAYOUT_KEY = "sunny.layout";

export function defaultLayout(sections = DEFAULT_SECTIONS) {
  return sections.map((section) => ({ id: section.id, visible: true }));
}

export function normalizeLayout(saved, sections = DEFAULT_SECTIONS) {
  const order = new Map(sections.map((section, index) => [section.id, index]));
  const seen = new Set();
  const layout = [];
  for (const item of Array.isArray(saved) ? saved : []) {
    const id = typeof item?.id === "string" ? item.id : "";
    if (!order.has(id) || seen.has(id)) continue;
    seen.add(id);
    layout.push({ id, visible: item.visible !== false });
  }
  for (const section of sections) {
    if (seen.has(section.id)) continue;
    const slot = Math.min(order.get(section.id), layout.length);
    layout.splice(slot, 0, { id: section.id, visible: true });
  }
  return layout;
}

export function moveSection(layout, id, delta) {
  return reorderSection(layout, id, layout.findIndex((item) => item.id === id) + delta);
}

export function reorderSection(layout, id, toIndex) {
  const next = layout.map((item) => ({ id: item.id, visible: item.visible !== false }));
  const from = next.findIndex((item) => item.id === id);
  if (from < 0 || toIndex < 0 || toIndex >= next.length || from === toIndex) return next;
  const [item] = next.splice(from, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function setSectionVisible(layout, id, visible) {
  return layout.map((item) => (item.id === id ? { id: item.id, visible: Boolean(visible) } : { id: item.id, visible: item.visible !== false }));
}

export function readLayout(storage, sections = DEFAULT_SECTIONS) {
  try {
    return normalizeLayout(JSON.parse(storage.getItem(LAYOUT_KEY) || "null"), sections);
  } catch {
    return defaultLayout(sections);
  }
}

export function writeLayout(layout, storage) {
  storage.setItem(LAYOUT_KEY, JSON.stringify(layout.map((item) => ({ id: item.id, visible: item.visible !== false }))));
}
