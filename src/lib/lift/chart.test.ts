import { describe, expect, it } from "vitest";
import { linePlot, yDomain } from "./chart";

describe("yDomain", () => {
  it("fits the data with headroom rather than anchoring at zero", () => {
    // 185→195 over a block is real progress; a 0-based axis flattens it.
    const { min, max } = yDomain([185, 190, 195]);
    expect(min).toBeCloseTo(184, 5);
    expect(max).toBeCloseTo(196, 5);
  });

  it("never drops the floor below zero", () => {
    expect(yDomain([1, 2]).min).toBe(0.9);
    expect(yDomain([0, 1]).min).toBe(0);
  });

  it("gives a flat series a non-zero span so points don't stack on one row", () => {
    const { min, max } = yDomain([200, 200]);
    expect(max).toBeGreaterThan(min);
  });

  it("handles an all-zero series without dividing by zero", () => {
    const { min, max } = yDomain([0, 0]);
    expect(max).toBeGreaterThan(min);
  });

  it("falls back to a unit range with no data", () => {
    expect(yDomain([])).toEqual({ min: 0, max: 1 });
  });
});

describe("linePlot", () => {
  const data = [
    { date: "2026-09-01", value: 100 },
    { date: "2026-09-08", value: 110 },
    { date: "2026-09-15", value: 120 },
  ];

  it("spans the plot area left to right and puts the highest value highest", () => {
    const plot = linePlot(data);
    expect(plot.points[0].cx).toBeCloseTo(plot.plot.left, 5);
    expect(plot.points[2].cx).toBeCloseTo(plot.plot.right, 5);
    expect(plot.points[2].cy).toBeLessThan(plot.points[0].cy);
  });

  it("centres a lone point instead of pinning it to the left edge", () => {
    const plot = linePlot([data[0]]);
    expect(plot.points[0].cx).toBeCloseTo((plot.plot.left + plot.plot.right) / 2, 5);
  });

  it("draws no path until there are two points to join", () => {
    expect(linePlot([]).path).toBe("");
    expect(linePlot([data[0]]).path).toBe("");
    expect(linePlot(data).path.startsWith("M")).toBe(true);
  });

  it("keeps every point inside the plot area", () => {
    const plot = linePlot(data);
    for (const p of plot.points) {
      expect(p.cy).toBeGreaterThanOrEqual(plot.plot.top);
      expect(p.cy).toBeLessThanOrEqual(plot.plot.bottom);
    }
  });
});
