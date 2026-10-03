import { Plugin } from "@opencode/plugin/tui"
import type { SessionInfo, SessionStatsInfo } from "@opencode/client"
import { TokenUsage } from "@opencode/schema/token-usage"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import {
  formatDayLabel,
  lastLocalDays,
  localTimezone,
  millisecondsUntilNextLocalMidnight,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
} from "@opencode/util/usage-periods"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Locale } from "../../util/locale"
import { statsNumber } from "../system/stats-data"

/**
 * Token usage dashboard.
 *
 * Totals and request counts come from `session.stats`, which recomputes them from the
 * authoritative session/message rows on every call. Events are treated purely as
 * invalidation signals, so a dropped SSE frame or a duplicate delivery can never inflate
 * a counter: the only thing an event does is schedule a fresh read.
 *
 * Known upstream semantics this surface inherits rather than corrects:
 * - `stats.tokens` omits compaction usage on default local installs (the durable event log
 *   is not persisted) and always omits title usage.
 * - `session_v2.tokens_*` can disagree with message totals after revert, fork, or retry.
 * - Aggregation does not clamp negative token leaves, so display floors at zero.
 */

const SETTLE_MS = 150
const DAY_COUNT = 7
const MAX_SESSIONS = 4
const SESSION_LIST_LIMIT = 50
export const BAR_WIDTH = 20

// The sidebar is 42 columns wide with 2 columns of padding and 1 reserved for the
// scrollbar, leaving 37. Columns are declared once and every row is built from them, so
// header and body cannot drift apart and no row can wrap the panel.
export const TABLE_WIDTH = 37
const COLUMN_RULE = "│"
const STATUS_DOT = "●"

/** Exactly one blank line separates the sections. Never more: the sidebar is short. */
const SECTION_SPACER = 1

/** One blank line between two adjacent non-zero daily bars. */
const DAY_SPACER = 1

// One header rule per table, a spacer before the second and third sections, and the worst case
// of six spacers inside a week where every day was active.
const TABLE_RULES = 3
const SECTION_SPACERS = 2
const DAY_SPACERS = DAY_COUNT - 1

/** Below this height the 7-day chart hides. */
export const COMPACT_HEIGHT = 26 + TABLE_RULES + SECTION_SPACERS + DAY_SPACERS

/** Below this height the session list is capped at two rows instead of four. */
export const FULL_SESSIONS_HEIGHT = 34 + TABLE_RULES + SECTION_SPACERS + DAY_SPACERS

type Column = { header: string; width: number; align: "left" | "right" }

const PERIOD_COLUMNS: Column[] = [
  // 21 fits "MONTH · 28 SEP–02 OCT", which appears when the week straddles a month boundary.
  { header: "PERIOD", width: 21, align: "left" },
  { header: "TOKENS", width: 6, align: "right" },
  { header: "REQUESTS", width: 8, align: "right" },
]

const SESSION_STATUS_WIDTH = 6
const SESSION_COLUMNS: Column[] = [
  { header: "SESSION", width: 13, align: "left" },
  { header: "TOKENS", width: 7, align: "right" },
  { header: "REQUESTS", width: 8, align: "right" },
  // Left-aligned so the status dots line up down the column.
  { header: "STATUS", width: SESSION_STATUS_WIDTH, align: "left" },
]

const DAY_COLUMNS: Column[] = [
  { header: "DATE", width: 7, align: "left" },
  { header: "USAGE", width: BAR_WIDTH, align: "left" },
  { header: "TOKENS", width: 8, align: "right" },
]

export const TABLES = [PERIOD_COLUMNS, SESSION_COLUMNS, DAY_COLUMNS]

/** The width a rendered row occupies: its cells plus one column rule between each pair. */
export function tableDeclaredWidth(columns: readonly Column[]) {
  return columns.reduce((sum, column) => sum + column.width, 0) + columns.length - 1
}

type Tokens = TokenUsage.Info

/** Session and period totals, floored because aggregation can surface negative leaves. */
export function usageTotal(tokens: Tokens | undefined) {
  if (!tokens) return 0
  return Math.max(0, TokenUsage.total(tokens))
}

/**
 * Horizontal bar scaled against the largest value in the displayed range. Length is the only
 * encoding, so a repeated middle dot can never read as punctuation instead of a bar.
 *
 * The full block keeps the bar solid and legible. It cannot separate itself: fonts draw every
 * filled block glyph at full cell height, so two bars in the same column touch and read as one
 * taller bar. `dayLines` spends a blank row on that instead, which is font-independent.
 */
export function bar(value: number, max: number, width = BAR_WIDTH) {
  if (!(value > 0) || !(max > 0)) return ""
  return "█".repeat(Math.max(1, Math.round(Math.min(1, value / max) * width)))
}

export function statusLabel(status: "idle" | "running", outcome: SessionInfo["outcome"]) {
  if (status === "running") return "RUN"
  if (outcome === "succeeded") return "DONE"
  if (outcome === "failed") return "FAIL"
  if (outcome === "interrupted") return "STOP"
  return "IDLE"
}

export type SessionRow = {
  id: string
  name: string
  tokens: number
  steps: number | undefined
  running: boolean
  status: string
}

export function selectSessions(input: {
  sessions: readonly SessionInfo[]
  status: (sessionID: string) => "idle" | "running"
  limit?: number
}) {
  const rows = input.sessions
    .map((info) => {
      const status = input.status(info.id)
      return {
        id: info.id,
        name: withTimestampedFallback(info),
        tokens: usageTotal(info.tokens),
        steps: info.steps,
        updated: info.time.updated,
        running: status === "running",
        status: statusLabel(status, info.outcome),
      }
    })
    // A session with no tokens and no live work carries no signal worth a row.
    .filter((row) => row.running || row.tokens > 0)
    .toSorted(
      (a, b) => Number(b.running) - Number(a.running) || b.tokens - a.tokens || b.updated - a.updated,
    )
  const limit = input.limit ?? MAX_SESSIONS
  return { rows: rows.slice(0, limit), total: rows.length, overflow: Math.max(0, rows.length - limit) }
}

export type DayRow = { key: string; label: string; tokens: number }

export function dayRows(activity: readonly { date: string; tokens?: Tokens }[] | undefined, now: number) {
  const byKey = new Map((activity ?? []).map((entry) => [entry.date, entry]))
  return lastLocalDays(now, DAY_COUNT).map((period) => ({
    key: period.key,
    label: formatDayLabel(period.key),
    tokens: usageTotal(byKey.get(period.key)?.tokens),
  }))
}

/** A period's request count, grouped for readability. */
export function formatRequests(steps: number | undefined) {
  if (steps === undefined) return "-"
  return steps.toLocaleString("en-US")
}

/**
 * A session's request count. Session counts are small, so compact notation is identical to
 * the plain value while still guaranteeing the cell cannot push the row past the panel.
 */
export function formatSessionRequests(steps: number | undefined) {
  if (steps === undefined) return "-"
  return statsNumber(steps)
}

/**
 * One cell, clipped to its column. `padEnd` does not shorten an overlong value, so a long
 * session title is cut here rather than pushing the row past the panel.
 */
export function tableCell(text: string, column: Column) {
  const clipped = Locale.truncateWidth(text, column.width)
  return column.align === "left" ? clipped.padEnd(column.width) : clipped.padStart(column.width)
}

/** Header and body rows are built the same way, so the two always line up. */
export function tableRow(columns: readonly Column[], values: readonly string[]) {
  return columns.map((column, index) => tableCell(values[index] ?? "", column)).join(COLUMN_RULE)
}

export function tableHeader(columns: readonly Column[]) {
  return tableRow(columns, columns.map((column) => column.header))
}

/**
 * The `SESSION | TOKENS | REQUESTS` cells. The status cell is returned separately so only
 * the status indicator and its label carry the status colour, matching the MCP section
 * where the name and values stay muted.
 */
export function formatSessionCells(row: { name: string; tokens: number; steps?: number }) {
  return tableRow(SESSION_COLUMNS.slice(0, 3), [
    row.name,
    statsNumber(row.tokens),
    formatSessionRequests(row.steps),
  ])
}

/** The status cell, dot included. Padded rather than coloured so the caller owns the colour. */
export function formatSessionStatus(status: string) {
  return `${STATUS_DOT} ${status}`.padEnd(SESSION_STATUS_WIDTH)
}

/** One complete `SESSION | TOKENS | REQUESTS | STATUS` line, status dot included. */
export function formatSessionRow(row: { name: string; tokens: number; steps?: number; status: string }) {
  return `${formatSessionCells(row)}${COLUMN_RULE}${formatSessionStatus(row.status)}`
}

/**
 * The panel footer. `ACTIVE` counts the sessions actually listed, which is what the panel
 * shows, rather than only the ones currently running. `TOTAL` is flush to the table edge.
 */
export function formatSessionsFooter(shown: number, totalTokens: number) {
  const total = `TOTAL: ${statsNumber(totalTokens)}`
  return `${`ACTIVE: ${shown}`.padEnd(TABLE_WIDTH - total.length)}${total}`
}

export function formatPeriodHeader() {
  return tableHeader(PERIOD_COLUMNS)
}

/** One `PERIOD | TOKENS | REQUESTS` row. */
export function formatPeriodRow(label: string, stats: SessionStatsInfo | undefined) {
  return tableRow(PERIOD_COLUMNS, [
    label,
    statsNumber(usageTotal(stats?.tokens)),
    formatRequests(stats?.steps),
  ])
}

export function formatDayHeader() {
  return tableHeader(DAY_COLUMNS)
}

/** One `DATE | USAGE | TOKENS` row. The bar scales against `max` from the same range. */
export function formatDayRow(day: DayRow, max: number) {
  return tableRow(DAY_COLUMNS, [day.label, bar(day.tokens, max, BAR_WIDTH), statsNumber(day.tokens)])
}

export type DayLine = { kind: "day"; row: DayRow } | { kind: "spacer" }

/**
 * Day rows interleaved with a blank row between two adjacent non-zero bars. Filled block glyphs
 * touch vertically because a terminal row has no leading, so without this two active days in a
 * row read as a single taller bar. Zero days already read as empty and never need a spacer.
 */
export function dayLines(days: readonly DayRow[]): DayLine[] {
  return days.flatMap((row, index) => {
    const adjacent = index > 0 && row.tokens > 0 && days[index - 1]!.tokens > 0
    return adjacent ? [{ kind: "spacer" as const }, { kind: "day" as const, row }] : [{ kind: "day" as const, row }]
  })
}

/** `TODAY · 02 OCT 2026`, sized to the 21-column period cell. */
export function periodLabel(name: string, from: number, to: number) {
  const today = startOfLocalDay(to)
  if (from === today) return `${name} · ${formatDayKey(today, true)}`
  const right = formatDayKey(to)
  // Inside one month the left bound only needs its day number.
  if (from >= startOfLocalMonth(to)) return `${name} · ${dayNumber(from)}–${right}`
  return `${name} · ${formatDayKey(from)}–${right}`
}

function dayNumber(time: number) {
  return `${new Date(time).getDate()}`.padStart(2, "0")
}

function monthOf(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(date)
}

function formatDayKey(time: number, withYear = false) {
  const date = new Date(time)
  const day = `${date.getDate()}`.padStart(2, "0")
  const month = monthOf(date).toUpperCase()
  return withYear ? `${day} ${month} ${date.getFullYear()}` : `${day} ${month}`
}

type Snapshot = {
  today?: SessionStatsInfo
  week?: SessionStatsInfo
  month?: SessionStatsInfo
  days?: SessionStatsInfo
  sessions: SessionInfo[]
}

export function TokenUsageDashboard(props: { context: Plugin.Context; sessionID: string }) {
  const context = props.context
  const theme = context.theme
  const dimensions = useTerminalDimensions()
  const [snapshot, setSnapshot] = createSignal<Snapshot>({ sessions: [] })

  // A fresh read of every authoritative aggregate. Never a delta from an event.
  async function reconcile() {
    const now = Date.now()
    const timezone = localTimezone()
    const weekStart = startOfLocalWeek(now)
    const days = lastLocalDays(now, DAY_COUNT)
    const options = { to: now, timezone, tools: "none" as const }
    try {
      const [today, week, month, history, sessions] = await Promise.all([
        context.client.session.stats({ ...options, from: startOfLocalDay(now) }),
        context.client.session.stats({ ...options, from: weekStart }),
        context.client.session.stats({ ...options, from: startOfLocalMonth(now) }),
        context.client.session.stats({ ...options, from: days[0]?.from ?? weekStart }),
        context.client.session.list({ limit: SESSION_LIST_LIMIT, order: "desc" }),
      ])
      setSnapshot({ today, week, month, days: history, sessions: sessions.data ?? [] })
    } catch (error) {
      // A failed reconcile keeps the previous snapshot; the next event retries.
      console.error("Failed to reconcile token usage dashboard", error)
    }
  }

  let settleTimer: ReturnType<typeof setTimeout> | undefined
  const settle = () => {
    if (settleTimer) return
    settleTimer = setTimeout(() => {
      settleTimer = undefined
      void reconcile()
    }, SETTLE_MS)
  }

  let midnightTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleMidnight = () => {
    if (midnightTimer) clearTimeout(midnightTimer)
    midnightTimer = setTimeout(
      () => {
        scheduleMidnight()
        void reconcile()
      },
      millisecondsUntilNextLocalMidnight(Date.now()),
    )
  }

  onMount(() => {
    void reconcile()
    scheduleMidnight()
    // Usage arriving, and session lifecycle changing, both only mark the snapshot stale.
    const unsubscribes = [
      context.data.on("session.step.ended", settle),
      context.data.on("session.step.failed", settle),
      context.data.on("session.usage.updated", settle),
      context.data.on("session.created", settle),
      context.data.on("session.deleted", settle),
      context.data.on("session.execution.started", settle),
      context.data.on("session.execution.succeeded", settle),
      context.data.on("session.execution.failed", settle),
      context.data.on("session.execution.interrupted", settle),
    ]
    // The event stream is volatile by contract, so a reconnect can drop frames that were
    // never delivered. `data.listen` is the raw emitter and still carries `server.connected`,
    // which the typed `useEvent` helper filters out, so it is the only reconnect signal here.
    unsubscribes.push(
      context.data.listen(({ details }) => {
        if (details.type === "server.connected") void reconcile()
      }),
    )
    onCleanup(() => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    })
  })
  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
    if (midnightTimer) clearTimeout(midnightTimer)
  })

  const now = () => Date.now()

  // The panel spends one line per table on its header rule and one blank line before each
  // section after the first, so both height gates move down by every line the panel gains.
  // Keeping them derived means a future section or rule cannot silently overflow the sidebar.
  const compact = createMemo(() => dimensions().height < COMPACT_HEIGHT)
  const sessionLimit = createMemo(() => (dimensions().height < FULL_SESSIONS_HEIGHT ? 2 : MAX_SESSIONS))

  const sessions = createMemo(() => {
    const state = snapshot()
    return selectSessions({
      sessions: state.sessions,
      status: (sessionID) => context.data.session.status(sessionID),
      limit: sessionLimit(),
    })
  })

  const days = createMemo(() => dayRows(snapshot().days?.activity, now()))
  const dayMax = createMemo(() => days().reduce((max, day) => Math.max(max, day.tokens), 0))

  const periods = createMemo(() => {
    const state = snapshot()
    const at = now()
    return [
      { label: periodLabel("TODAY", startOfLocalDay(at), at), stats: state.today },
      { label: periodLabel("WEEK", startOfLocalWeek(at), at), stats: state.week },
      { label: periodLabel("MONTH", startOfLocalMonth(at), at), stats: state.month },
    ]
  })

  const sessionsTotal = createMemo(() => sessions().rows.reduce((sum, row) => sum + row.tokens, 0))

  return (
    <box>
      <text fg={theme.text.base}>
        <b>Token usage</b>
      </text>
      <Show when={snapshot().today}>
        <text fg={theme.text.base}>
          <b>{formatPeriodHeader()}</b>
        </text>
        <box width={TABLE_WIDTH} border={["top"]} borderColor={theme.border.base} />
        <For each={periods()}>
          {(period) => <text fg={theme.text.muted}>{formatPeriodRow(period.label, period.stats)}</text>}
        </For>
      </Show>

      <Show when={sessions().rows.length > 0}>
        <box height={SECTION_SPACER} />
        <text fg={theme.text.base}>
          <b>Active sessions</b>
        </text>
        <text fg={theme.text.base}>
          <b>{tableHeader(SESSION_COLUMNS)}</b>
        </text>
        <box width={TABLE_WIDTH} border={["top"]} borderColor={theme.border.base} />
        <For each={sessions().rows}>
          {(row) => (
            <text fg={theme.text.muted}>
              {formatSessionCells(row)}
              {COLUMN_RULE}
              <span style={{ fg: row.running ? theme.text.feedback.success.base : theme.text.muted }}>
                {formatSessionStatus(row.status)}
              </span>
            </text>
          )}
        </For>
        <text fg={theme.text.muted}>{formatSessionsFooter(sessions().rows.length, sessionsTotal())}</text>
        <Show when={sessions().overflow > 0}>
          <text fg={theme.text.muted}>{`+${sessions().overflow} more`}</text>
        </Show>
      </Show>

      <Show when={!compact()}>
        <box height={SECTION_SPACER} />
        <text fg={theme.text.base}>
          <b>Last 7 days</b>
        </text>
        <text fg={theme.text.base}>
          <b>{formatDayHeader()}</b>
        </text>
        <box width={TABLE_WIDTH} border={["top"]} borderColor={theme.border.base} />
        <For each={dayLines(days())}>
          {(line) =>
            line.kind === "spacer" ? (
              <box height={DAY_SPACER} />
            ) : (
              <text fg={theme.text.muted}>{formatDayRow(line.row, dayMax())}</text>
            )
          }
        </For>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.token-usage",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <TokenUsageDashboard context={context} sessionID={props.sessionID} />,
    })
  },
})