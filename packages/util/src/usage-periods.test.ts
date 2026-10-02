import { describe, expect, test } from "bun:test"
import {
  formatDayLabel,
  lastLocalDays,
  localDayKey,
  localDayOrdinal,
  localTimezone,
  millisecondsUntilNextLocalMidnight,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
} from "./usage-periods.js"

// All expectations are built from local calendar constructors so the suite holds in any zone.
const at = (year: number, month: number, day: number, hours = 12, minutes = 0) =>
  new Date(year, month - 1, day, hours, minutes).getTime()
const key = (year: number, month: number, day: number) => localDayKey(at(year, month, day))

describe("usage period boundaries", () => {
  test("today starts at local midnight regardless of the time of day", () => {
    expect(startOfLocalDay(at(2026, 10, 2, 0))).toBe(startOfLocalDay(at(2026, 10, 2, 23)))
    expect(startOfLocalDay(at(2026, 10, 2, 23))).toBe(at(2026, 10, 2, 0))
    expect(localDayKey(at(2026, 10, 2, 0, 0))).toBe("2026-10-02")
  })

  test("week starts on the Monday on or before the given day", () => {
    // 2026-10-02 is a Friday, so its week began on 2026-09-28.
    expect(startOfLocalWeek(at(2026, 10, 2))).toBe(at(2026, 9, 28, 0))
    // Monday maps to itself.
    expect(startOfLocalWeek(at(2026, 9, 28))).toBe(at(2026, 9, 28, 0))
    // Sunday belongs to the week that started the previous Monday.
    expect(startOfLocalWeek(at(2026, 10, 4))).toBe(at(2026, 9, 28, 0))
  })

  test("month starts on the first of the month", () => {
    expect(startOfLocalMonth(at(2026, 10, 2))).toBe(at(2026, 10, 1, 0))
    expect(startOfLocalMonth(at(2026, 10, 31, 23))).toBe(at(2026, 10, 1, 0))
  })

  test("year boundaries roll into the new year", () => {
    expect(startOfLocalMonth(at(2027, 1, 1))).toBe(at(2027, 1, 1, 0))
    expect(startOfLocalDay(at(2027, 1, 1))).toBe(at(2027, 1, 1, 0))
    expect(localDayKey(at(2026, 12, 31, 23))).toBe("2026-12-31")
    expect(localDayKey(at(2027, 1, 1, 0))).toBe("2027-01-01")
  })

  test("seven day range ends today and is contiguous", () => {
    const days = lastLocalDays(at(2026, 10, 2), 7)
    expect(days).toHaveLength(7)
    expect(days.map((day) => day.key)).toEqual([
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ])
    for (const day of days) expect(day.to - day.from).toBeGreaterThan(0)
    // Each range begins exactly where the previous one ended.
    for (const [index, day] of days.slice(1).entries()) expect(days[index]!.to).toBe(day.from)
    // The oldest bound is the local midnight before the window.
    expect(days[0]!.from).toBe(at(2026, 9, 26, 0))
    expect(days[6]!.to).toBe(at(2026, 10, 3, 0))
  })

  test("seven day range crosses a month boundary", () => {
    expect(lastLocalDays(at(2026, 3, 2), 7).map((day) => day.key)).toEqual([
      "2026-02-24",
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ])
  })

  test("seven day range covers a DST transition without dropping or duplicating a day", () => {
    // Northern-hemisphere clocks move forward in late March; the window spans it.
    const days = lastLocalDays(at(2026, 3, 30), 7)
    expect(new Set(days.map((day) => day.key)).size).toBe(7)
    expect(days[6]!.key).toBe("2026-03-30")
    for (const [index, day] of days.slice(1).entries()) expect(days[index]!.to).toBe(day.from)
  })

  test("midnight countdown lands on the next local midnight", () => {
    const now = at(2026, 10, 2, 23, 30)
    expect(now + millisecondsUntilNextLocalMidnight(now)).toBe(at(2026, 10, 3, 0))
    expect(millisecondsUntilNextLocalMidnight(now)).toBeGreaterThanOrEqual(1_000)
  })

  test("day ordinals are stable within a local day", () => {
    expect(localDayOrdinal(at(2026, 10, 2, 1))).toBe(localDayOrdinal(at(2026, 10, 2, 23)))
    expect(localDayOrdinal(at(2026, 10, 3))).toBe(localDayOrdinal(at(2026, 10, 2)) + 1)
  })

  test("day labels render as short uppercase month and day", () => {
    expect(formatDayLabel("2026-09-26")).toBe("26 SEP")
    expect(formatDayLabel("2026-10-02")).toBe("02 OCT")
    expect(formatDayLabel("2026-12-31")).toBe("31 DEC")
  })

  test("resolves a timezone name with a UTC fallback", () => {
    expect(typeof localTimezone()).toBe("string")
    expect(localTimezone().length).toBeGreaterThan(0)
  })
})

describe("key helper", () => {
  test("formats local day keys with zero padding", () => {
    expect(key(2026, 1, 5)).toBe("2026-01-05")
  })
})