/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { SessionInfo, SessionStatsInfo } from "@opencode/client"
import type { Context } from "@opencode/plugin/tui/context"
import {
  BAR_WIDTH,
  bar,
  COMPACT_HEIGHT,
  FULL_SESSIONS_HEIGHT,
  dayRows,
  formatDayHeader,
  formatDayRow,
  formatPeriodHeader,
  formatPeriodRow,
  formatRequests,
  formatSessionCells,
  formatSessionRequests,
  formatSessionRow,
  formatSessionsFooter,
  formatSessionStatus,
  periodLabel,
  selectSessions,
  statusLabel,
  TABLES,
  TABLE_WIDTH,
  tableDeclaredWidth,
  TokenUsageDashboard,
  usageTotal,
} from "../../src/feature-plugins/sidebar/token-usage"
import { startOfLocalDay, startOfLocalMonth, startOfLocalWeek } from "@opencode/util/usage-periods"

const at = (year: number, month: number, day: number, hours = 12) => new Date(year, month - 1, day, hours).getTime()

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "ses_one",
    projectID: "prj",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    steps: 0,
    time: { created: at(2026, 10, 1), updated: at(2026, 10, 2) },
    location: { directory: "/workspace" },
    ...overrides,
  } as SessionInfo
}

function stats(overrides: Partial<SessionStatsInfo> = {}): SessionStatsInfo {
  return {
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    steps: 0,
    activity: [],
    models: [],
    ...overrides,
  } as SessionStatsInfo
}

describe("token totals", () => {
  test("sums every token field", () => {
    expect(usageTotal({ input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } })).toBe(15)
  })

  test("treats missing usage as zero", () => {
    expect(usageTotal(undefined)).toBe(0)
  })

  test("floors negative leaves rather than rendering a negative total", () => {
    expect(usageTotal({ input: -50, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })).toBe(0)
  })

  test("aggregates a whole period", () => {
    const total = usageTotal(stats({ tokens: { input: 1_240_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }).tokens)
    expect(total).toBe(1_240_000)
  })
})

describe("bar scaling", () => {
  test("scales the largest value against the requested width", () => {
    expect(bar(100, 100, 10)).toHaveLength(10)
    expect(bar(50, 100, 10)).toHaveLength(5)
  })

  test("never renders an empty bar for a positive value", () => {
    expect(bar(1, 1_000_000, 10)).toHaveLength(1)
  })

  test("renders nothing for zero values and for an all-zero range", () => {
    expect(bar(0, 100)).toBe("")
    expect(bar(50, 0)).toBe("")
    expect(bar(0, 0)).toBe("")
  })

  test("draws every non-zero value with the solid block glyph", () => {
    for (const share of [0.001, 0.01, 0.1, 0.143, 0.25, 0.5, 0.75, 1]) {
      expect(bar(share * 370, 370, 20)).toBe("█".repeat(Math.max(1, Math.round(share * 20))))
    }
  })

  test("never draws a small value as dots or other punctuation", () => {
    // 52.9M against a 370M day is the case that used to render as "···".
    const row = bar(52.9, 370, 20)
    expect(row).toBe("███")
    expect(row).not.toContain("·")
    expect(row).not.toContain("░")
    // 3 of 20 cells is the closest whole-cell match to 14.3%.
    expect(row.length / 20).toBeCloseTo(0.143, 1)
  })

  test("keeps at least one solid cell for a value far below the range", () => {
    expect(bar(1, 1_000_000, 20)).toBe("█")
  })

  test("never exceeds the width", () => {
    expect(bar(500, 100, 10)).toHaveLength(10)
  })
})

describe("session status mapping", () => {
  test("uses the authoritative running state", () => {
    expect(statusLabel("running", undefined)).toBe("RUN")
    expect(statusLabel("running", "succeeded")).toBe("RUN")
  })

  test("distinguishes a finished outcome from a session that never ran", () => {
    expect(statusLabel("idle", undefined)).toBe("IDLE")
    expect(statusLabel("idle", "succeeded")).toBe("DONE")
    expect(statusLabel("idle", "failed")).toBe("FAIL")
    expect(statusLabel("idle", "interrupted")).toBe("STOP")
  })
})

describe("session selection", () => {
  test("returns nothing when there are no sessions", () => {
    const result = selectSessions({ sessions: [], status: () => "idle" })
    expect(result.rows).toHaveLength(0)
    expect(result.total).toBe(0)
    expect(result.overflow).toBe(0)
  })

  test("drops idle sessions that never consumed tokens", () => {
    const result = selectSessions({
      sessions: [session({ id: "ses_a", title: "Empty" })],
      status: () => "idle",
    })
    expect(result.rows).toHaveLength(0)
  })

  test("keeps a running session even before it has consumed tokens", () => {
    const result = selectSessions({
      sessions: [session({ id: "ses_a", title: "Fresh" })],
      status: (id) => (id === "ses_a" ? "running" : "idle"),
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.running).toBe(true)
  })

  test("lists multiple simultaneous sessions", () => {
    const sessions = [
      session({ id: "ses_a", title: "M020 Verifier", tokens: { input: 107_500, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
      session({ id: "ses_b", title: "CodeAtlas Parser", tokens: { input: 82_300, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
      session({ id: "ses_c", title: "DFB Backend", tokens: { input: 41_800, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ]
    const result = selectSessions({ sessions, status: () => "idle" })
    expect(result.rows.map((row) => row.name)).toEqual(["M020 Verifier", "CodeAtlas Parser", "DFB Backend"])
    expect(result.total).toBe(3)
  })

  test("orders running sessions first, then by tokens", () => {
    const sessions = [
      session({ id: "ses_idle_big", title: "Idle big", tokens: { input: 900_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
      session({ id: "ses_run_small", title: "Running small", tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ]
    const result = selectSessions({
      sessions,
      status: (id) => (id === "ses_run_small" ? "running" : "idle"),
    })
    expect(result.rows.map((row) => row.name)).toEqual(["Running small", "Idle big"])
  })

  test("caps at four rows and reports the overflow", () => {
    const sessions = Array.from({ length: 7 }, (_, index) =>
      session({
        id: `ses_${index}`,
        title: `Session ${index}`,
        tokens: { input: (index + 1) * 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    )
    const result = selectSessions({ sessions, status: () => "idle" })
    expect(result.rows).toHaveLength(4)
    expect(result.total).toBe(7)
    expect(result.overflow).toBe(3)
    // The heaviest sessions win the limited slots.
    expect(result.rows.map((row) => row.name)).toEqual(["Session 6", "Session 5", "Session 4", "Session 3"])
  })

  test("falls back to a timestamped title when the session is untitled", () => {
    const result = selectSessions({
      sessions: [session({ id: "ses_a", title: undefined, tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })],
      status: () => "idle",
    })
    expect(result.rows[0]?.name).toBe(`New session - ${new Date(at(2026, 10, 1)).toISOString()}`)
  })

  test("honours a smaller row limit for short terminals", () => {
    const sessions = Array.from({ length: 5 }, (_, index) =>
      session({ id: `ses_${index}`, title: `Session ${index}`, tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
    )
    const result = selectSessions({ sessions, status: () => "idle", limit: 2 })
    expect(result.rows).toHaveLength(2)
    expect(result.overflow).toBe(3)
  })
})

describe("daily rows", () => {
  test("always produces seven days ending today, zero filling gaps", () => {
    const rows = dayRows([{ date: "2026-10-02", tokens: { input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }], at(2026, 10, 2))
    expect(rows).toHaveLength(7)
    expect(rows.at(-1)?.key).toBe("2026-10-02")
    expect(rows[0]?.key).toBe("2026-09-26")
    expect(rows.at(-1)?.tokens).toBe(5)
    expect(rows[0]?.tokens).toBe(0)
  })

  test("tolerates a missing activity series", () => {
    expect(dayRows(undefined, at(2026, 10, 2))).toHaveLength(7)
  })

  test("labels days for the sidebar column", () => {
    expect(dayRows([], at(2026, 10, 2))[0]?.label).toBe("26 SEP")
  })
})

describe("row formatting", () => {
  test("formats tokens and requests into aligned columns", () => {
    const row = formatPeriodRow("TODAY · 02 OCT 2026", stats({
      tokens: { input: 1_240_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      steps: 1842,
    }))
    expect(row).toContain("1.2M")
    expect(row).toContain("1,842")
    expect(row.startsWith("TODAY · 02 OCT 2026")).toBe(true)
  })

  test("renders an empty period before any data arrives", () => {
    const row = formatPeriodRow("TODAY · 02 OCT 2026", undefined)
    expect(row).toContain("0")
    expect(row).not.toContain("undefined")
  })

  test("scales the day bar against the range maximum", () => {
    const rows = dayRows(
      [
        { date: "2026-10-01", tokens: { input: 500, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
        { date: "2026-10-02", tokens: { input: 1000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
      ],
      at(2026, 10, 2),
    )
    const max = Math.max(...rows.map((row) => row.tokens))
    const full = formatDayRow(rows[rows.length - 1]!, max)
    const half = formatDayRow(rows[rows.length - 2]!, max)
    expect(full).toContain("1K")
    expect(half).toContain("500")
    // Length is the only encoding, so the largest day fills the column and half is half as
    // long. Comparing glyph offsets would only prove where the bar starts, which is fixed.
    expect(full.split("█").length - 1).toBe(BAR_WIDTH)
    expect(half.split("█").length - 1).toBe(BAR_WIDTH / 2)
  })
})

describe("session request counts", () => {
  test("formats a request count with thousands separators", () => {
    expect(formatRequests(1842)).toBe("1,842")
    expect(formatRequests(6)).toBe("6")
    expect(formatRequests(0)).toBe("0")
  })

  test("marks an unavailable count explicitly instead of inventing zero", () => {
    expect(formatRequests(undefined)).toBe("-")
    expect(formatSessionRequests(undefined)).toBe("-")
  })

  test("keeps a session count compact so it cannot widen the column", () => {
    expect(formatSessionRequests(23)).toBe("23")
    expect(formatSessionRequests(6)).toBe("6")
    expect(formatSessionRequests(0)).toBe("0")
    expect(formatSessionRequests(1_234_567)).toBe("1.2M")
  })

  test("carries the server-reported step count through selection", () => {
    const result = selectSessions({
      sessions: [
        session({
          id: "ses_a",
          title: "M020 Verifier",
          steps: 23,
          tokens: { input: 107_500, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
        session({
          id: "ses_b",
          title: "CodeAtlas Parser",
          steps: 17,
          tokens: { input: 82_300, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ],
      status: () => "idle",
    })
    expect(result.rows.map((row) => row.steps)).toEqual([23, 17])
  })

  test("keeps the count undefined when the projection did not report one", () => {
    const result = selectSessions({
      sessions: [
        session({
          id: "ses_a",
          title: "No steps",
          steps: undefined,
          tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ],
      status: () => "idle",
    })
    expect(result.rows[0]?.steps).toBeUndefined()
    expect(formatSessionRow({ name: "No steps", tokens: 10, steps: result.rows[0]?.steps, status: "IDLE" })).toContain(
      "-",
    )
  })

  test("keeps the status cell separate so only it can carry the status colour", () => {
    // Name, tokens and requests stay muted; only the status label is coloured.
    const cells = formatSessionCells({ name: "M020 Verifier", tokens: 107_500, steps: 23 })
    expect(cells).toContain("M020 Verifier")
    expect(cells).toContain("107.5K")
    expect(cells).toContain("23")
    expect(cells).not.toContain("RUN")
    expect(cells).not.toContain("IDLE")
    expect(formatSessionStatus("RUN")).toContain("RUN")
    expect(formatSessionStatus("IDLE")).toContain("IDLE")
  })

  test("a full row is the muted cells, a column rule, then the status cell", () => {
    const cells = formatSessionCells({ name: "M020 Verifier", tokens: 107_500, steps: 23 })
    expect(formatSessionRow({ name: "M020 Verifier", tokens: 107_500, steps: 23, status: "RUN" })).toBe(
      `${cells}│${formatSessionStatus("RUN")}`,
    )
  })

  test("renders name, tokens, requests and status in aligned columns", () => {
    const row = formatSessionRow({ name: "M020 Verifier", tokens: 107_500, steps: 23, status: "RUN" })
    expect(row).toContain("M020 Verifier")
    expect(row).toContain("107.5K")
    expect(row).toContain("23")
    expect(row).toContain("RUN")
    expect(row.length).toBe(TABLE_WIDTH)
  })

  test("zero requests still renders as a real count", () => {
    const row = formatSessionRow({ name: "Quiet", tokens: 0, steps: 0, status: "IDLE" })
    expect(row).toContain("0")
    expect(row).not.toContain("-")
  })

  test("clips an overlong title so the row cannot wrap the panel", () => {
    const row = formatSessionRow({
      name: "A very long session title that will not fit",
      tokens: 1_240_000_000,
      steps: 1_234_567,
      status: "STOP",
    })
    // The status dot now lives inside the status cell, so the row claims the full width.
    expect(row.length).toBe(TABLE_WIDTH)
    expect(row).toContain("1.2B")
    expect(row).toContain("1.2M")
    expect(row).toContain("STOP")
  })
})

describe("table rendering", () => {
  test("every table is exactly the sidebar width, column rules included", () => {
    for (const columns of TABLES) expect(tableDeclaredWidth(columns)).toBe(TABLE_WIDTH)
  })

  test("headers and their rows share the same column rules", () => {
    for (const [header, row] of [
      [formatPeriodHeader(), formatPeriodRow("TODAY · 02 OCT 2026", stats({ steps: 1 }))],
      [formatDayHeader(), formatDayRow({ key: "d", label: "02 OCT", tokens: 20_700 }, 20_700)],
    ] as const) {
      expect(header.split("│").length).toBe(row.split("│").length)
      expect(header.length).toBe(row.length)
    }
  })

  test("column rules separate every cell, so the row reads as a table", () => {
    const row = formatSessionRow({ name: "M020 Verifier", tokens: 107_500, steps: 23, status: "RUN" })
    expect(row.split("│")).toHaveLength(4)
    expect(formatPeriodRow("TODAY · 02 OCT 2026", stats({ steps: 1 })).split("│")).toHaveLength(3)
    expect(formatDayRow({ key: "d", label: "02 OCT", tokens: 1 }, 1).split("│")).toHaveLength(3)
  })

  test("a header wider than its values does not push the row wider", () => {
    expect(formatPeriodHeader().length).toBe(TABLE_WIDTH)
    expect(formatPeriodRow("TODAY · 02 OCT 2026", stats({ steps: 1 })).length).toBe(TABLE_WIDTH)
  })

  test("an overlong cell is clipped rather than widening the table", () => {
    const row = formatPeriodRow("A PERIOD LABEL FAR TOO LONG FOR THE COLUMN", stats({ steps: 1 }))
    expect(row.length).toBe(TABLE_WIDTH)
  })

  test("the 7-day bar stays inside its own USAGE column", () => {
    const row = formatDayRow({ key: "d", label: "02 OCT", tokens: 999_999_999 }, 999_999_999)
    const [, usage, tokens] = row.split("│")
    expect(usage?.length).toBe(BAR_WIDTH)
    expect(tokens?.trim().length).toBeGreaterThan(0)
  })

  test("the footer stays inside the table width", () => {
    expect(formatSessionsFooter(4, 137_300_000).length).toBe(TABLE_WIDTH)
    expect(formatSessionsFooter(4, 137_300_000)).toContain("TOTAL: 137.3M")
  })

  test("the status dot lives in the status cell, not before the row", () => {
    // The previous layout prefixed a coloured dot outside the columns.
    const row = formatSessionRow({ name: "Quiet", tokens: 0, steps: 0, status: "DONE" })
    expect(row.startsWith("●")).toBe(false)
    expect(row).toContain("● DONE")
  })
})

describe("panel footer", () => {
  test("counts the sessions displayed, not only the running ones", () => {
    // Four rows shown, three of them running: ACTIVE must read the shown count.
    const footer = formatSessionsFooter(4, 260_900)
    expect(footer).toContain("ACTIVE: 4")
    expect(footer).not.toContain("RUNNING")
  })

  test("labels the aggregate token total", () => {
    const footer = formatSessionsFooter(4, 260_900)
    expect(footer).toContain("TOTAL: 260.9K")
    expect(footer.length).toBe(37)
  })

  test("handles a single session and an empty total", () => {
    expect(formatSessionsFooter(1, 0)).toContain("ACTIVE: 1")
    expect(formatSessionsFooter(1, 0)).toContain("TOTAL: 0")
  })
})

describe("period labels", () => {
  const now = at(2026, 10, 2)

  test("labels today with the full date", () => {
    expect(periodLabel("TODAY", startOfLocalDay(now), now)).toBe("TODAY · 02 OCT 2026")
  })

  test("labels the week as a Monday-to-today range", () => {
    expect(periodLabel("WEEK", startOfLocalWeek(now), now)).toBe("WEEK · 28 SEP–02 OCT")
  })

  test("labels the month without repeating the month on both ends", () => {
    expect(periodLabel("MONTH", startOfLocalMonth(now), now)).toBe("MONTH · 01–02 OCT")
  })

  test("keeps every label inside the period column", () => {
    for (const from of [startOfLocalDay(now), startOfLocalWeek(now), startOfLocalMonth(now)]) {
      expect(periodLabel("MONTH", from, now).length).toBeLessThanOrEqual(21)
    }
  })
})

describe("section spacing", () => {
  const usage = (input: number) => ({ input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

  const fixture = (id: string, title: string, tokens: number, steps: number) =>
    session({ id, title, steps, tokens: usage(tokens) })

  function panelContext(options: { sessions?: SessionInfo[]; running?: string } = {}) {
    const base = RGBA.fromInts(200, 200, 200)
    const period = stats({ steps: 5, tokens: usage(103_800) })
    return {
      theme: {
        text: { base, muted: base, feedback: { success: { base: RGBA.fromInts(0, 255, 0) } } },
        border: { base: RGBA.fromInts(90, 90, 90) },
      },
      client: {
        session: {
          stats: async () => period,
          list: async () => ({ data: options.sessions ?? [] }),
        },
      },
      data: {
        on: () => () => {},
        listen: () => () => {},
        session: { status: (id: string) => (id === options.running ? "running" : "idle") },
      },
    } as unknown as Context
  }

  async function panel(height: number, sessions: SessionInfo[] = []) {
    const app = await testRender(() => <TokenUsageDashboard context={panelContext({ sessions })} sessionID="probe" />, {
      width: 42,
      height,
    })
    try {
      await app.renderOnce()
      await new Promise((resolve) => setTimeout(resolve, 400))
      await app.renderOnce()
      const lines = app
        .captureCharFrame()
        .split("\n")
        .map((line) => line.trimEnd())
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
      return lines
    } finally {
      app.renderer.destroy()
    }
  }

  const rows = [
    fixture("a", "Quick check-in", 42_200, 2),
    fixture("b", "Greeting", 21_500, 1),
    fixture("c", "Friendly greeting", 21_400, 1),
    fixture("d", "Another session", 18_900, 1),
    fixture("e", "Overflow one", 9_000, 3),
    fixture("f", "Overflow two", 8_000, 3),
  ]

  test("the height gates account for the rules and the spacers", () => {
    expect(COMPACT_HEIGHT).toBe(31)
    expect(FULL_SESSIONS_HEIGHT).toBe(39)
  })

  test("separates the sections with one blank line and nothing else", async () => {
    const lines = await panel(44, rows)
    expect(lines[0]).toBe("Token usage")
    expect(lines.join("\n")).toContain("Active sessions")
    expect(lines.join("\n")).toContain("Last 7 days")
    // Three tables rendered, so two boundaries and therefore exactly two blank lines.
    expect(lines.filter((line) => line === "").length).toBe(2)
    const sessions = lines.findIndex((line) => line.includes("Active sessions"))
    const days = lines.findIndex((line) => line.includes("Last 7 days"))
    expect(lines[sessions - 1]).toBe("")
    expect(lines[sessions - 2]).not.toBe("")
    expect(lines[days - 1]).toBe("")
    expect(lines[days - 2]).not.toBe("")
  })

  test("keeps every table row at the sidebar width", async () => {
    for (const line of await panel(44, rows)) {
      if (line.includes("│")) expect(line.length).toBe(TABLE_WIDTH)
    }
  })

  test("takes the spacer away with the section it belongs to", async () => {
    const tall = await panel(COMPACT_HEIGHT + 2, rows)
    expect(tall.join("\n")).toContain("Last 7 days")
    expect(tall.filter((line) => line === "").length).toBe(2)

    const short = await panel(COMPACT_HEIGHT - 2, rows)
    expect(short.join("\n")).not.toContain("Last 7 days")
    expect(short.filter((line) => line === "").length).toBe(1)
  })

  test("still caps the session rows below the full height", async () => {
    const capped = await panel(FULL_SESSIONS_HEIGHT - 2, rows)
    expect(capped.join("\n")).toContain("ACTIVE: 2")
    // Two of six listed, so four are still hidden behind the overflow line.
    expect(capped.join("\n")).toContain("+4 more")

    const full = await panel(FULL_SESSIONS_HEIGHT + 2, rows)
    expect(full.join("\n")).toContain("ACTIVE: 4")
    expect(full.join("\n")).toContain("+2 more")
  })
})