import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigRouter } from "@opencode-ai/core/config/router"

describe("ConfigRouter", () => {
  test("decodes a minimal router config", () => {
    const decoded = Schema.decodeUnknownSync(ConfigRouter.Info)({
      enabled: true,
      mode: "auto",
      classifier: { strategy: "heuristic" },
    })

    expect(decoded.enabled).toBe(true)
    expect(decoded.mode).toBe("auto")
    expect(decoded.classifier?.strategy).toBe("heuristic")
  })

  test("fills in default values when resolving", () => {
    const resolved = ConfigRouter.resolve(undefined)

    expect(resolved.enabled).toBe(true)
    expect(resolved.mode).toBe("auto")
    expect(resolved.classifier!.strategy).toBe("hybrid")
    expect(resolved.compaction!.bounded_history_depth).toBe(5)
    expect(resolved.tiers!.trivial?.[0]?.provider).toBe("openai")
    expect(resolved.fallback!.on_rate_limit).toBe("next-cheapest")
  })

  test("preserves user overrides while filling defaults", () => {
    const resolved = ConfigRouter.resolve(
      new ConfigRouter.Info({
        mode: "manual",
        classifier: new ConfigRouter.Classifier({ confidence_threshold: 0.9 }),
      }),
    )

    expect(resolved.mode).toBe("manual")
    expect(resolved.classifier!.confidence_threshold).toBe(0.9)
    expect(resolved.classifier!.strategy).toBe("hybrid")
  })
})
