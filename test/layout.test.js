import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SECTIONS,
  defaultLayout,
  moveSection,
  normalizeLayout,
  readLayout,
  reorderSection,
  setSectionVisible,
  writeLayout,
} from "../js/layout.js";

function memory() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

test("layout keeps a saved order and visibility", () => {
  const storage = memory();
  const layout = setSectionVisible(moveSection(defaultLayout(), "daily", -1), "details", false);
  writeLayout(layout, storage);
  const restored = readLayout(storage);
  assert.equal(restored.find((item) => item.id === "details").visible, false);
  assert.ok(restored.findIndex((item) => item.id === "daily") < restored.findIndex((item) => item.id === "hourly"));
});

test("new sections are inserted at their default position and unknown ids are dropped", () => {
  const saved = [
    { id: "retired", visible: true },
    { id: "hourly", visible: false },
    { id: "current", visible: true },
    { id: "hourly", visible: true },
  ];
  const sections = [
    { id: "current", label: "Current" },
    { id: "sunrise", label: "Sunrise" },
    { id: "hourly", label: "Hourly" },
  ];
  const layout = normalizeLayout(saved, sections);
  assert.deepEqual(layout.map((item) => item.id), ["hourly", "sunrise", "current"]);
  assert.equal(layout.find((item) => item.id === "hourly").visible, false);
  assert.equal(layout.find((item) => item.id === "sunrise").visible, true);
});

test("reorder and move stay inside the list", () => {
  const layout = defaultLayout();
  const first = layout[0].id;
  assert.equal(moveSection(layout, first, -1)[0].id, first);
  const moved = reorderSection(layout, "details", 0);
  assert.equal(moved[0].id, "details");
  assert.equal(moved.at(-1).id, "daily");
  assert.equal(moved.length, DEFAULT_SECTIONS.length);
});

test("corrupt layout storage falls back to the default", () => {
  const storage = memory();
  storage.setItem("sunny.layout", "{");
  assert.deepEqual(readLayout(storage), defaultLayout());
});
