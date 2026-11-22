import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "bun:test";
import { vi } from "#test/vi";
import { formatDateTime, formatTime, formatDate, formatZoneLabel, setAppTimeZone, getAppTimeZone } from "@/shared/utils/dateTime.js";

const INSTANT = "2026-11-20T01:00:00.000Z";

describe("shared date formatter", () => {
  it("formats the same instant per timezone", () => {
    expect(formatTime(INSTANT, "Asia/Jakarta")).toBe("08:00:00");
    expect(formatTime(INSTANT, "UTC")).toBe("01:00:00");
    expect(formatDate(INSTANT, "Asia/Jakarta")).toBe("11/20/2026");
    expect(formatDate("2026-11-19T20:00:00.000Z", "Asia/Jakarta")).toBe("11/20/2026");
    expect(formatDate("2026-11-19T20:00:00.000Z", "UTC")).toBe("11/19/2026");
    expect(formatDateTime(INSTANT, "Asia/Jakarta")).toBe("11/20/2026, 08:00:00");
  });

  it("defaults to the app timezone and tolerates bad input", () => {
    setAppTimeZone("Asia/Jakarta");
    expect(getAppTimeZone()).toBe("Asia/Jakarta");
    expect(formatTime(INSTANT)).toBe("08:00:00");
    setAppTimeZone("Not/AZone");
    expect(getAppTimeZone()).toBe("Asia/Jakarta");
    expect(formatTime("garbage")).toBe("");
  });

  it("labels the zone", () => {
    expect(formatZoneLabel("Asia/Jakarta")).toBe("GMT+7");
    expect(formatZoneLabel("UTC")).toBe("UTC");
  });
});

describe("usage chart follows process.env.TZ", () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.DATA_DIR;
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("TZ=Asia/Jakarta: 01:00Z lands in the 08:00 bucket of 2026-11-20", async () => {
    process.env.TZ = "Asia/Jakarta";
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "9router-app-tz-"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(INSTANT));
    vi.resetModules();
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    await db.saveRequestUsage({
      provider: "openai", model: "gpt-4", connectionId: "c1", endpoint: "/v1/chat", status: "ok",
      timestamp: INSTANT, tokens: { prompt_tokens: 3, completion_tokens: 2 },
    });
    // 00:30Z yesterday-in-UTC terms is 07:30 Jakarta: same local day; 2026-11-19T16:59Z is the previous Jakarta day.
    await db.saveRequestUsage({
      provider: "openai", model: "gpt-4", connectionId: "c1", endpoint: "/v1/chat", status: "ok",
      timestamp: "2026-11-19T16:59:00.000Z", tokens: { prompt_tokens: 9, completion_tokens: 9 },
    });
    const buckets = await db.getChartData("today");
    expect(buckets).toHaveLength(24);
    expect(buckets[0].label).toBe("00:00");
    expect(buckets[8].label).toBe("08:00");
    expect(buckets[8].tokens).toBe(5);
    expect(buckets[8].requests).toBe(1);
    // the 16:59Z request is before local midnight, so excluded from "today"
    expect(buckets.reduce((n, b) => n + b.requests, 0)).toBe(1);
    const days = await db.getChartData("7d");
    expect(days.at(-1).requests).toBe(1);
    expect(days.at(-2).requests).toBe(1);
  });
});
