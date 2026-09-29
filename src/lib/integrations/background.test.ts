import { describe, expect, it } from "vitest";
import { cronAuthorized, secretMatches, stravaEventAction } from "./background";

describe("stravaEventAction", () => {
  it("syncs on a new or edited activity", () => {
    expect(stravaEventAction({ object_type: "activity", aspect_type: "create", owner_id: 42, object_id: 1 })).toEqual({
      kind: "sync",
      athleteId: "42",
    });
    expect(stravaEventAction({ object_type: "activity", aspect_type: "update", owner_id: 42 }).kind).toBe("sync");
  });

  it("ignores a deleted activity, keeping the run in history", () => {
    expect(stravaEventAction({ object_type: "activity", aspect_type: "delete", owner_id: 42 })).toEqual({ kind: "ignore" });
  });

  it("recognises an athlete revoking the app", () => {
    expect(
      stravaEventAction({ object_type: "athlete", aspect_type: "update", owner_id: 42, updates: { authorized: "false" } }),
    ).toEqual({ kind: "deauthorize", athleteId: "42" });
  });

  it("ignores other athlete updates and malformed events", () => {
    expect(stravaEventAction({ object_type: "athlete", aspect_type: "update", owner_id: 42, updates: {} }).kind).toBe("ignore");
    expect(stravaEventAction({ object_type: "activity", aspect_type: "create" }).kind).toBe("ignore");
  });
});

describe("secretMatches / cronAuthorized", () => {
  it("accepts only the exact secret", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3cre", "s3cret")).toBe(false);
    expect(secretMatches("s3cret", undefined)).toBe(false);
    expect(secretMatches(null, "s3cret")).toBe(false);
  });

  it("reads the bearer token Vercel Cron sends", () => {
    expect(cronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(cronAuthorized("s3cret", "s3cret")).toBe(false);
    expect(cronAuthorized(null, "s3cret")).toBe(false);
    // An unset secret must never authorize, even an empty bearer.
    expect(cronAuthorized("Bearer ", undefined)).toBe(false);
  });
});
