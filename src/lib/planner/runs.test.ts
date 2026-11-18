import { describe, expect, it } from "vitest";
import { buildEasyRun, buildHardRun, buildHardRunByTotal, buildLongRun, buildRace, MIN_HARD_RUN } from "./runs";

describe("hard runs", () => {
  it("builds a tempo with warm-up, block and cool-down", () => {
    const r = buildHardRun("tempo", 20, 10, "intermediate");
    expect(r.durationMin).toBe(35);
    expect(r.prescription).toMatchObject({ warmupMin: 10, hardMin: 20, cooldownMin: 5, reps: null });
    expect(r.prescription.warmupMin + r.prescription.hardMin + r.prescription.cooldownMin).toBe(r.durationMin);
  });
  it("builds intervals with 3 min reps (4 for advanced) and 2 min jogs, counting only the reps as hard", () => {
    const r = buildHardRun("interval", 15, 10, "intermediate");
    expect(r.prescription).toMatchObject({ reps: 5, repMin: 3, recoveryMin: 2, hardMin: 15 });
    const total = r.prescription.warmupMin + 5 * 3 + 4 * 2 + r.prescription.cooldownMin;
    expect(total).toBe(r.durationMin);
    expect(r.durationMin % 5).toBe(0);
    expect(buildHardRun("interval", 16, 10, "advanced").prescription).toMatchObject({ reps: 4, repMin: 4 });
  });
  it("never goes under the minimum, and never fewer than two reps", () => {
    expect(buildHardRun("tempo", 5, 5, "beginner").durationMin).toBeGreaterThanOrEqual(MIN_HARD_RUN);
    expect(buildHardRun("interval", 1, 5, "beginner").prescription.reps).toBe(2);
  });
  it("builds to an exact total", () => {
    for (const total of [25, 30, 35, 40, 50, 60]) {
      expect(buildHardRunByTotal("tempo", total, 10, "intermediate").durationMin).toBe(total);
      const iv = buildHardRunByTotal("interval", total, 10, "intermediate");
      expect(iv.durationMin).toBeGreaterThanOrEqual(total);
      expect(iv.durationMin).toBeLessThanOrEqual(total + 4);
    }
  });
});

describe("easy, long and race runs", () => {
  it("have no hard minutes", () => {
    expect(buildEasyRun(30).prescription.hardMin).toBe(0);
    expect(buildLongRun(60).prescription.hardMin).toBe(0);
    expect(buildEasyRun(30).prescription.description).toContain("30 min");
  });
  it("sizes a race at about 6 min per km", () => {
    const r = buildRace(10);
    expect(r.durationMin).toBe(60);
    expect(r.prescription.description).toBe("Race: 10 km");
    expect(buildRace(42.2).durationMin).toBe(253);
  });
});
