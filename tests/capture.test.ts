import { test, expect } from "vitest";
import { captureRect } from "../src/lib/capture-geometry";
import { cameraFrame } from "../src/lib/camera";
import { newStep } from "../src/lib/model";
test("wide tab capture excludes display-sized padding", () => {
  expect(captureRect(1920, 1080, { width: 1536, height: 674 })).toEqual({
    x: 0,
    y: 119,
    width: 1920,
    height: 842,
  });
  expect(captureRect(1920, 1080, { width: 1920, height: 1080 })).toEqual({
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
});
test("camera eases into a click and pulls back to show the result without revealing empty edges", () => {
  const s = newStep("video");
  s.hotspots = [
    { id: "click", x: 2, y: 91, label: "Settings", target: "next" },
  ];
  s.click = { x: 2, y: 91, time: 0.8, sequence: 1 };
  const first = cameraFrame(s, 0, 3),
    click = cameraFrame(s, 0.8, 3),
    after = cameraFrame(s, 2, 3);
  expect(first.zoom).toBe(1);
  expect(click.zoom).toBeGreaterThan(1.6);
  expect(after.zoom).toBe(1);
  for (let t = 0; t < 3; t += 0.01) {
    const p = cameraFrame(s, t, 3);
    expect(p.tx).toBeLessThanOrEqual(0);
    expect(p.ty).toBeLessThanOrEqual(0);
    expect(p.tx + p.zoom * 100).toBeGreaterThanOrEqual(99.999);
    expect(p.ty + p.zoom * 100).toBeGreaterThanOrEqual(99.999);
  }
});
