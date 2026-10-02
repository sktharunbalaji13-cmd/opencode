export * as Session from "./session.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Location } from "./location.js"
import { Model } from "./model.js"
import { Project } from "./project.js"
import { DateTimeUtcFromMillis, NonNegativeInt, optional, RelativePath } from "./schema.js"
import { SessionEvent } from "./session-event.js"
import { SessionID } from "./session-id.js"
import { SessionMetadata } from "./session-metadata.js"
import { Money } from "./money.js"
import { Permission } from "./permission.js"
import { TokenUsage } from "./token-usage.js"
import { Revert } from "./session-revert.js"
import { SessionFork } from "./session-fork.js"

export const ID = SessionID
export type ID = SessionID

export const Metadata = SessionMetadata
export type Metadata = SessionMetadata

export const Event = SessionEvent

export { Revert }
export const ForkBoundary = SessionFork.Boundary
export type ForkBoundary = SessionFork.Boundary

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),
  fork: Schema.Struct({
    sessionID: ID,
    boundary: ForkBoundary,
  }).pipe(optional),
  projectID: Project.ID,
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  cost: Money.USD,
  tokens: TokenUsage.Info,
  /**
   * Model requests made in this session. One assistant step counts as one request, matching
   * `SessionStats.steps`, and messages copied in from a fork boundary are excluded the same
   * way. Derived from the indexed message rows rather than stored, so it covers every step
   * the session has taken. Absent on projections that do not read messages.
   */
  steps: NonNegativeInt.pipe(optional),
  /** Outcome of the last completed execution, recorded at `time.idle`. Absent until a run reaches a terminal transition. */
  outcome: Schema.Literals(["succeeded", "failed", "interrupted"]).pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    idle: DateTimeUtcFromMillis.pipe(optional),
    viewed: DateTimeUtcFromMillis.pipe(optional),
    archived: DateTimeUtcFromMillis.pipe(optional),
  }),
  title: Schema.String.pipe(optional),
  location: Location.Ref,
  subpath: RelativePath.pipe(optional),
  metadata: Metadata.pipe(optional),
  /** Evaluated after the agent's rules; the last matching rule wins. */
  permissions: Permission.Ruleset.pipe(optional),
  revert: Revert.pipe(optional),
}).annotate({ identifier: "Session.Info" })

export const ListAnchor = Schema.Struct({
  id: ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
}).annotate({ identifier: "Session.ListAnchor" })
export interface ListAnchor extends Schema.Schema.Type<typeof ListAnchor> {}
