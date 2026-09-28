import { describe, expect, it } from "vitest";
import {
  assignLanes,
  DEFAULT_WINDOW_END,
  DEFAULT_WINDOW_START,
  gridWindow,
  hourMarks,
  MINUTES_IN_DAY,
  minuteAt,
  placeSpan,
  splitAcrossDays,
} from "./layout";

const window = { startMin: 6 * 60, endMin: 22 * 60 };

describe("gridWindow", () => {
  it("is the default window when everything fits inside it", () => {
    expect(gridWindow([{ startMin: 9 * 60, endMin: 10 * 60 }])).toEqual({
      startMin: DEFAULT_WINDOW_START,
      endMin: DEFAULT_WINDOW_END,
    });
  });

  it("widens to whole hours around anything that would be clipped", () => {
    // A 5:20am run must be on the grid, not cut off above it.
    expect(gridWindow([{ startMin: 5 * 60 + 20, endMin: 22 * 60 + 40 }])).toEqual({
      startMin: 5 * 60,
      endMin: 23 * 60,
    });
  });

  it("never runs past the ends of the day", () => {
    const w = gridWindow([{ startMin: 0, endMin: MINUTES_IN_DAY }]);
    expect(w.startMin).toBe(0);
    expect(w.endMin).toBe(MINUTES_IN_DAY);
  });

  it("is the default window with nothing on the grid", () => {
    expect(gridWindow([])).toEqual({ startMin: DEFAULT_WINDOW_START, endMin: DEFAULT_WINDOW_END });
  });
});

describe("hourMarks", () => {
  it("marks each whole hour inside the window", () => {
    const marks = hourMarks({ startMin: 6 * 60, endMin: 9 * 60 });
    expect(marks).toEqual([360, 420, 480]);
  });
});

describe("placeSpan", () => {
  it("puts the window's start at the top and its end at the bottom", () => {
    expect(placeSpan({ startMin: 6 * 60, endMin: 7 * 60 }, window).topPct).toBe(0);

    const last = placeSpan({ startMin: 21 * 60, endMin: 22 * 60 }, window);
    expect(last.topPct + last.heightPct).toBeCloseTo(100, 5);
  });

  it("gives an hour a sixteenth of a sixteen-hour window", () => {
    expect(placeSpan({ startMin: 12 * 60, endMin: 13 * 60 }, window).heightPct).toBeCloseTo(6.25, 5);
  });

  it("clips a span that starts before or ends after the window", () => {
    const placed = placeSpan({ startMin: 0, endMin: 7 * 60 }, window);
    expect(placed.topPct).toBe(0);
    expect(placed.heightPct).toBeCloseTo(6.25, 5);
  });

  it("keeps a very short session legible instead of drawing a hairline", () => {
    expect(placeSpan({ startMin: 9 * 60, endMin: 9 * 60 + 5 }, window).heightPct).toBeGreaterThan(2);
  });

  it("never lets a card overflow the column", () => {
    const placed = placeSpan({ startMin: 21 * 60 + 50, endMin: 23 * 60 }, window);
    expect(placed.topPct + placed.heightPct).toBeLessThanOrEqual(100.0001);
  });
});

describe("minuteAt", () => {
  it("maps the top and bottom of a column to the window's ends", () => {
    expect(minuteAt(0, window)).toBe(6 * 60);
    expect(minuteAt(1, window)).toBe(22 * 60);
  });

  it("snaps to the quarter hour", () => {
    expect(minuteAt(0.5, window) % 15).toBe(0);
    expect(minuteAt(0.2, window) % 15).toBe(0);
  });

  it("clamps a drop outside the column instead of inventing a time", () => {
    expect(minuteAt(-3, window)).toBe(6 * 60);
    expect(minuteAt(9, window)).toBe(22 * 60);
  });
});

describe("splitAcrossDays", () => {
  const days = ["2026-09-14", "2026-09-15", "2026-09-16"];

  it("leaves a same-day block whole", () => {
    const segments = splitAcrossDays("2026-09-14", 540, "2026-09-14", 1020, days);
    expect(segments).toEqual([
      { date: "2026-09-14", startMin: 540, endMin: 1020, startsHere: true, endsHere: true },
    ]);
  });

  it("still draws a block that began weeks before the visible days", () => {
    const segments = splitAcrossDays("2026-08-20", 540, "2026-09-15", 600, days);
    expect(segments.map((s) => s.date)).toEqual(["2026-09-14", "2026-09-15"]);
    expect(segments[0]).toMatchObject({ startMin: 0, startsHere: false });
    expect(segments[1]).toMatchObject({ endMin: 600, endsHere: true });
  });

  it("clips an overnight shift into both days", () => {
    // 10pm to 6am is one row but two things to draw; a grid that placed it
    // only on the first day would leave the next morning looking free.
    const segments = splitAcrossDays("2026-09-14", 22 * 60, "2026-09-15", 6 * 60, days);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ date: "2026-09-14", endMin: MINUTES_IN_DAY, endsHere: false });
    expect(segments[1]).toMatchObject({ date: "2026-09-15", startMin: 0, startsHere: false });
  });

  it("drops a zero-length tail from a block ending exactly at midnight", () => {
    const segments = splitAcrossDays("2026-09-14", 22 * 60, "2026-09-15", 0, days);
    expect(segments).toHaveLength(1);
    expect(segments[0].date).toBe("2026-09-14");
  });

  it("keeps only the days the grid is showing", () => {
    // A block starting the day before the week still colours Monday.
    const segments = splitAcrossDays("2026-09-13", 22 * 60, "2026-09-14", 6 * 60, days);
    expect(segments.map((s) => s.date)).toEqual(["2026-09-14"]);
  });
});

describe("assignLanes", () => {
  it("leaves sequential items in one lane", () => {
    const laid = assignLanes([
      { startMin: 540, endMin: 600 },
      { startMin: 600, endMin: 660 },
    ]);
    expect(laid.map((i) => i.lane)).toEqual([0, 0]);
    expect(laid[0].lanes).toBe(1);
  });

  it("puts overlapping items side by side rather than hiding one", () => {
    const laid = assignLanes([
      { startMin: 540, endMin: 660 },
      { startMin: 600, endMin: 720 },
    ]);
    expect(laid.map((i) => i.lane)).toEqual([0, 1]);
    expect(laid.every((i) => i.lanes === 2)).toBe(true);
  });

  it("reuses a lane once its occupant has finished", () => {
    const laid = assignLanes([
      { startMin: 540, endMin: 600 },
      { startMin: 550, endMin: 610 },
      { startMin: 620, endMin: 680 },
    ]);
    expect(laid.map((i) => i.lane)).toEqual([0, 1, 0]);
  });

  it("gives every card in a column the same width", () => {
    const laid = assignLanes([
      { startMin: 540, endMin: 660 },
      { startMin: 600, endMin: 720 },
      { startMin: 900, endMin: 960 },
    ]);
    expect(new Set(laid.map((i) => i.lanes)).size).toBe(1);
  });

  it("handles an empty column", () => {
    expect(assignLanes([])).toEqual([]);
  });
});
