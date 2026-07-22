import { describe, expect, it } from "vitest";

import { getLondonKickoffFormValues, parseLondonKickoff } from "@/lib/londonKickoff";

describe("London kickoff conversion", () => {
  it("converts a GMT winter kickoff to UTC", () => {
    expect(parseLondonKickoff("2026-01-15", "20:30")).toEqual({
      startsAtIso: "2026-01-15T20:30:00.000Z",
      displayTime: "15 Jan 2026, 20:30",
    });
  });

  it("converts a BST summer kickoff to UTC", () => {
    expect(parseLondonKickoff("2026-07-15", "20:30")).toEqual({
      startsAtIso: "2026-07-15T19:30:00.000Z",
      displayTime: "15 Jul 2026, 20:30",
    });
  });

  it("rejects invalid dates and times", () => {
    expect(parseLondonKickoff("2026-02-31", "20:30")).toBeNull();
    expect(parseLondonKickoff("2026-07-15", "24:00")).toBeNull();
    expect(parseLondonKickoff("15/07/2026", "20:30")).toBeNull();
  });

  it("rejects London daylight-saving gaps instead of guessing", () => {
    expect(parseLondonKickoff("2026-03-29", "01:30")).toBeNull();
  });

  it("rejects ambiguous London daylight-saving fall-back times", () => {
    expect(parseLondonKickoff("2026-10-25", "01:30")).toBeNull();
  });

  it("formats existing UTC kickoff timestamps for London form inputs", () => {
    expect(getLondonKickoffFormValues("2026-07-15T19:30:00.000Z")).toEqual({
      kickoffDate: "2026-07-15",
      kickoffTime: "20:30",
    });
    expect(getLondonKickoffFormValues(null)).toEqual({
      kickoffDate: "",
      kickoffTime: "",
    });
  });
});
