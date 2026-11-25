import { describe, it, expect, beforeEach } from "bun:test";
import { vi } from "#test/vi";
import {
  normalizeHealthKey,
  getUpstreamHealth,
  recordUpstreamStall,
  recordUpstreamSuccess,
  reorderByUpstreamHealth,
  resetUpstreamHealth,
} from "../../open-sse/services/upstreamHealth.js";
import {
  UPSTREAM_HEALTH_DEGRADE_BASE_MS,
  UPSTREAM_HEALTH_DEGRADE_MAX_MS,
  UPSTREAM_HEALTH_SLOW_TTFT_MS,
} from "../../open-sse/config/runtimeConfig.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

beforeEach(() => {
  resetUpstreamHealth();
});

describe("upstreamHealth state machine", () => {
  it("normalizes provider aliases to canonical provider/model keys", () => {
    expect(normalizeHealthKey("kn/deepseek-v4-1-flash:high")).toBe("kenari/deepseek-v4-1-flash:high");
    expect(normalizeHealthKey("kn", "deepseek-v4-1-flash:high")).toBe("kenari/deepseek-v4-1-flash:high");
    expect(normalizeHealthKey("ocg/deepseek-v4.1-flash")).toBe("opencode-go/deepseek-v4.1-flash");
    expect(normalizeHealthKey("opencode-go", "deepseek-v4.1-flash")).toBe("opencode-go/deepseek-v4.1-flash");
  });

  it("demotes immediately on pre-content stall and backs off exponentially up to cap", () => {
    const t0 = 1_000_000;
    const first = recordUpstreamStall("kn", "deepseek-v4-1-flash:high", {
      reason: "pre_content_stall",
      immediate: true,
      now: t0,
    });
    expect(first.degraded).toBe(true);
    expect(first.tier).toBe(2);
    expect(first.degradedUntil).toBe(t0 + UPSTREAM_HEALTH_DEGRADE_BASE_MS);

    const second = recordUpstreamStall("kn", "deepseek-v4-1-flash:high", {
      reason: "pre_content_stall",
      immediate: true,
      now: t0 + 1000,
    });
    expect(second.degradedUntil).toBe(t0 + 1000 + Math.min(UPSTREAM_HEALTH_DEGRADE_BASE_MS * 2, UPSTREAM_HEALTH_DEGRADE_MAX_MS));

    for (let i = 0; i < 6; i++) {
      recordUpstreamStall("kn", "deepseek-v4-1-flash:high", {
        reason: "pre_content_stall",
        immediate: true,
        now: t0 + 2000 + i,
      });
    }
    const capped = getUpstreamHealth("kenari/deepseek-v4-1-flash:high", undefined, t0 + 3000);
    expect(capped.degradedUntil).toBeLessThanOrEqual(t0 + 3000 + UPSTREAM_HEALTH_DEGRADE_MAX_MS);
  });

  it("requires threshold stalls within window when immediate is false, and expires after cooldown", () => {
    const t0 = 2_000_000;
    const afterOne = recordUpstreamStall("kenari", "deepseek-v4-1-flash:high", {
      reason: "stall_timeout",
      immediate: false,
      now: t0,
    });
    expect(afterOne.recentStalls).toBe(1);
    expect(afterOne.degraded).toBe(false);

    const afterTwo = recordUpstreamStall("kenari", "deepseek-v4-1-flash:high", {
      reason: "stall_timeout",
      immediate: false,
      now: t0 + 1000,
    });
    expect(afterTwo.recentStalls).toBe(2);
    expect(afterTwo.degraded).toBe(true);

    const afterExpiry = getUpstreamHealth("kenari/deepseek-v4-1-flash:high", undefined, t0 + 1000 + UPSTREAM_HEALTH_DEGRADE_BASE_MS + 1);
    expect(afterExpiry.degraded).toBe(false);
    expect(afterExpiry.tier).toBe(0);
  });

  it("soft-demotes persistently slow models and clears degradation on healthy TTFT", () => {
    const t0 = 3_000_000;
    const slowTtft = UPSTREAM_HEALTH_SLOW_TTFT_MS + 5000;
    recordUpstreamSuccess("kenari", "deepseek-v4-1-flash:high", slowTtft, t0);
    recordUpstreamSuccess("kenari", "deepseek-v4-1-flash:high", slowTtft, t0 + 100);
    expect(getUpstreamHealth("kn/deepseek-v4-1-flash:high", undefined, t0 + 150).slow).toBe(false);

    recordUpstreamSuccess("kenari", "deepseek-v4-1-flash:high", slowTtft, t0 + 200);
    const slowHealth = getUpstreamHealth("kn/deepseek-v4-1-flash:high", undefined, t0 + 250);
    expect(slowHealth.slow).toBe(true);
    expect(slowHealth.tier).toBe(1);

    expect(reorderByUpstreamHealth(["kn/deepseek-v4-1-flash:high", "ocg/deepseek-v4.1-flash"], t0 + 250)).toEqual([
      "ocg/deepseek-v4.1-flash",
      "kn/deepseek-v4-1-flash:high",
    ]);

    recordUpstreamStall("kenari", "deepseek-v4-1-flash:high", { immediate: true, now: t0 + 300 });
    expect(getUpstreamHealth("kn/deepseek-v4-1-flash:high", undefined, t0 + 350).degraded).toBe(true);

    recordUpstreamSuccess("kenari", "deepseek-v4-1-flash:high", 1200, t0 + 400);
    const recovered = getUpstreamHealth("kn/deepseek-v4-1-flash:high", undefined, t0 + 450);
    expect(recovered.degraded).toBe(false);
    expect(recovered.recentStalls).toBe(0);
  });
});

describe("combo health ordering", () => {
  it("demotes degraded models behind healthy fallbacks and keeps hard capability requirements first", async () => {
    recordUpstreamStall("anthropic", "claude-sonnet-4.6", {
      reason: "pre_content_stall",
      immediate: true,
    });

    const attempted = [];
    const handleSingleModel = vi.fn(async (_body, modelStr) => {
      attempted.push(modelStr);
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    });
    const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

    await handleComboChat({
      body: { messages: [{ role: "user", content: "plain text" }] },
      models: ["anthropic/claude-sonnet-4.6", "deepseek/deepseek-chat"],
      handleSingleModel,
      log,
      comboName: "health-text",
      comboStrategy: "fallback",
      preContentFailover: true,
    });

    expect(attempted).toEqual(["deepseek/deepseek-chat"]);

    attempted.length = 0;
    await handleComboChat({
      body: { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }] },
      models: ["deepseek/deepseek-chat", "anthropic/claude-sonnet-4.6"],
      handleSingleModel,
      log,
      comboName: "health-vision",
      comboStrategy: "fallback",
      autoSwitch: true,
      preContentFailover: true,
    });

    expect(attempted).toEqual(["anthropic/claude-sonnet-4.6"]);
  });
});
