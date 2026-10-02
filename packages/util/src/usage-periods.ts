/**
 * Local-calendar period boundaries for usage aggregation.
 *
 * Server-side day bucketing (`session.stats`) accepts a timezone and defaults to UTC,
 * so callers must send their own zone or a UTC+05:30 user gets every row on the wrong
 * day. These helpers compute the local midpoints to hand over as explicit ranges.
 *
 * Day grouping follows activity-calendar.ts: read the local calendar fields first, then
 * compare with UTC ordinals, so a DST transition can never add or drop a day.
 */

/** The host's IANA zone, falling back to UTC when the runtime cannot resolve one. */
export function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

/** Days since the epoch for the local calendar day containing `time`. */
export function localDayOrdinal(time: number) {
  const date = new Date(time)
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
}

/** `YYYY-MM-DD` in local time, matching the keys `session.stats` returns. */
export function localDayKey(time: number) {
  const date = new Date(time)
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Local midnight at the start of the day containing `time`. When a DST transition
 * removes midnight, the runtime normalizes to the first instant that does exist.
 */
export function startOfLocalDay(time: number) {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime()
}

/** Local midnight of the Monday on or before `time`. */
export function startOfLocalWeek(time: number) {
  const day = new Date(startOfLocalDay(time))
  // getDay() is 0 for Sunday; shift the offset so weeks begin on Monday.
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() - ((day.getDay() + 6) % 7),
    0,
    0,
    0,
    0,
  ).getTime()
}

/** Local midnight on the first of the month containing `time`. */
export function startOfLocalMonth(time: number) {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0).getTime()
}

/** Milliseconds from `time` until the next local midnight, floored so callers never spin. */
export function millisecondsUntilNextLocalMidnight(time: number) {
  const next = new Date(time)
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  return Math.max(1_000, next.getTime() - time)
}

export type UsagePeriod = {
  /** `YYYY-MM-DD` local day key, for matching against `session.stats` activity rows. */
  key: string
  /** Inclusive lower bound in epoch milliseconds. */
  from: number
  /** Exclusive upper bound in epoch milliseconds. */
  to: number
}

/**
 * The `days` consecutive local calendar days ending with the day containing `time`,
 * oldest first. Each bound is a real local midnight, so a 23- or 25-hour DST day is
 * covered exactly instead of being approximated with a fixed 24-hour step.
 */
export function lastLocalDays(time: number, days: number) {
  const today = startOfLocalDay(time)
  const startOf = (offset: number) => {
    const date = new Date(today)
    date.setDate(date.getDate() - offset)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime()
  }
  return Array.from({ length: days }, (_, index): UsagePeriod => {
    const offset = days - 1 - index
    const from = startOf(offset)
    return { key: localDayKey(from), from, to: startOf(offset - 1) }
  })
}

const monthLabel = new Intl.DateTimeFormat("en-US", { month: "short" })

/**
 * Renders a `YYYY-MM-DD` local day key as `26 SEP`. The key is parsed as a local date,
 * never UTC. Ordering and padding are assembled here rather than taken from a locale so
 * every column is the same width in a fixed-size sidebar.
 */
export function formatDayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
  return `${`${date.getDate()}`.padStart(2, "0")} ${monthLabel.format(date).toUpperCase()}`
}