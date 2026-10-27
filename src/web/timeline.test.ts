import { describe, expect, test } from "vitest"
import { ago, describeEvent } from "./timeline.ts"

describe("timeline", () => {
  test("describes events in Portuguese", () => {
    expect(describeEvent("moved", { from: "review", to: "in_progress" })).toBe(
      "moveu de Revisão para Em execução",
    )
    expect(describeEvent("edited", { fields: ["title", "contextFiles"] })).toBe(
      "editou o título, os arquivos relevantes",
    )
    expect(describeEvent("criteria_changed", { action: "checked" })).toBe("marcou um critério")
  })

  test("relative time", () => {
    const now = Date.parse("2026-10-27T12:00:00Z")
    expect(ago("2026-10-27T11:59:50Z", now)).toBe("agora")
    expect(ago("2026-10-27T11:55:00Z", now)).toBe("há 5 minutos")
    expect(ago("2026-10-26T12:00:00Z", now)).toBe("ontem")
  })
})
