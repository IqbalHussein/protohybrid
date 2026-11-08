import { describe, expect, it } from "vitest";
import { displayWeight, formatWeight, toStoredWeight } from "./units";

describe("weight units", () => {
  it("shows lb as stored", () => {
    expect(displayWeight(225, "lb")).toBe(225);
    expect(formatWeight(185.5, "lb")).toBe("185.5 lb");
    expect(displayWeight(null, "lb")).toBeNull();
  });

  it("round-trips kg entries to 1 decimal", () => {
    for (const kg of [20, 60, 100, 102.5, 142.5, 0.5]) {
      expect(displayWeight(toStoredWeight(kg, "kg"), "kg")).toBe(kg);
    }
  });

  it("converts lb to kg for display", () => {
    expect(displayWeight(220.462, "kg")).toBe(100);
    expect(formatWeight(45, "kg")).toBe("20.4 kg");
  });
});
