import { dayName } from "../model";
import type { LayoutSession, Constraint, Violation, WeekLayout } from "./types";

function region(s: LayoutSession): string {
  if (s.liftFocus === "upper" || s.liftFocus === "push" || s.liftFocus === "pull") return "upper";
  if (s.liftFocus === "lower" || s.liftFocus === "legs") return "lower";
  return "full";
}

export const spreadLifts: Constraint<WeekLayout> = {
  id: "spreadLifts",
  label: "Spread lifts",
  description: "Avoid training the same body region on consecutive days.",
  severity: "soft",
  scope: "week",
  weight: 5,
  check(layout) {
    const out: Violation[] = [];
    layout.days.forEach((day, i) => {
      const next = layout.days[(i + 1) % 7];
      for (const a of day.sessions)
        for (const b of next.sessions)
          if (a.type === "lift" && b.type === "lift" && region(a) === region(b))
            out.push({
              constraint: "spreadLifts",
              message: `${dayName(day.weekday)} and ${dayName(next.weekday)} both train the ${region(a) === "full" ? "full body" : `${region(a)} body`}.`,
              weekday: next.weekday,
              sessionKeys: [a.key, b.key],
            });
    });
    return out;
  },
};
