import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { ICON_NAMES, iconSlug, iconUrl } from "../js/icons.js";

test("every mapped Meteocons icon is self-hosted in both sets", () => {
  for (const name of ICON_NAMES) {
    for (const set of ["animated", "static"]) {
      assert.ok(existsSync(new URL(`../icons/meteocons/${set}/${name}.svg`, import.meta.url)), `${set}/${name}.svg`);
    }
  }
});

test("icon slugs pick day or night variants", () => {
  assert.equal(iconSlug({ type: "CLEAR" }, true), "clear-day");
  assert.equal(iconSlug({ type: "CLEAR" }, false), "clear-night");
  assert.equal(iconSlug({ type: "RAIN" }, false), "rain");
  assert.equal(iconSlug({ type: "SOMETHING_NEW" }, true), "partly-cloudy-day");
  assert.equal(iconUrl({ type: "CLEAR" }, { animated: true }), "icons/meteocons/animated/clear-day.svg");
});
