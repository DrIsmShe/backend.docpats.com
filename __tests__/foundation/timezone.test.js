import { describe, it, expect } from "vitest";
import {
  isValidTimezone,
  localToUtc,
  utcToLocal,
  formatLocal,
  startOfDayUtc,
  endOfDayUtc,
  addMinutes,
  diffMinutes,
} from "../../common/utils/timezone.js";

describe("timezone — validation", () => {
  it("recognises valid IANA zones", () => {
    expect(isValidTimezone("Asia/Baku")).toBe(true);
    expect(isValidTimezone("Europe/Moscow")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  it("rejects invalid zones", () => {
    expect(isValidTimezone("Foo/Bar")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
  });
});

describe("timezone — localToUtc / utcToLocal", () => {
  it("Baku 10:00 = UTC 06:00 (UTC+4)", () => {
    const utc = localToUtc("2026-05-15 10:00", "Asia/Baku");
    expect(utc.toISOString()).toBe("2026-05-15T06:00:00.000Z");
  });

  it("converts UTC back to local", () => {
    const utc = new Date("2026-05-15T06:00:00.000Z");
    const local = utcToLocal(utc, "Asia/Baku");
    expect(local.hour).toBe(10);
    expect(local.minute).toBe(0);
  });

  it("handles ISO format with T", () => {
    const utc = localToUtc("2026-05-15T10:00", "Asia/Baku");
    expect(utc.toISOString()).toBe("2026-05-15T06:00:00.000Z");
  });

  it("rejects invalid timezone", () => {
    expect(() => localToUtc("2026-05-15 10:00", "Foo/Bar")).toThrow();
  });

  it("rejects malformed datetime", () => {
    expect(() => localToUtc("not-a-date", "Asia/Baku")).toThrow();
  });
});

describe("timezone — formatting", () => {
  it("formats UTC date in clinic timezone", () => {
    const utc = new Date("2026-05-15T06:00:00.000Z");
    const formatted = formatLocal(utc, "Asia/Baku", "yyyy-LL-dd HH:mm");
    expect(formatted).toBe("2026-05-15 10:00");
  });
});

describe("timezone — day boundaries", () => {
  it("startOfDayUtc respects clinic timezone", () => {
    const sod = startOfDayUtc("Asia/Baku", "2026-05-15");
    // Baku midnight = UTC 20:00 previous day
    expect(sod.toISOString()).toBe("2026-05-14T20:00:00.000Z");
  });

  it("endOfDayUtc respects clinic timezone", () => {
    const eod = endOfDayUtc("Asia/Baku", "2026-05-15");
    // Baku 23:59:59.999 = UTC 19:59:59.999
    expect(eod.toISOString()).toBe("2026-05-15T19:59:59.999Z");
  });
});

describe("timezone — date arithmetic", () => {
  it("addMinutes adds minutes correctly", () => {
    const t1 = new Date("2026-05-15T10:00:00.000Z");
    const t2 = addMinutes(t1, 90);
    expect(t2.toISOString()).toBe("2026-05-15T11:30:00.000Z");
  });

  it("diffMinutes computes minute difference", () => {
    const t1 = new Date("2026-05-15T10:00:00.000Z");
    const t2 = new Date("2026-05-15T11:30:00.000Z");
    expect(diffMinutes(t2, t1)).toBe(90);
  });

  it("diffMinutes is signed", () => {
    const t1 = new Date("2026-05-15T10:00:00.000Z");
    const t2 = new Date("2026-05-15T11:30:00.000Z");
    expect(diffMinutes(t1, t2)).toBe(-90);
  });
});
