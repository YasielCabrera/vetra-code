/**
 * ProjectionAutomationRepository - Projection repository interface for automations.
 *
 * Owns persistence operations for projected automation records in the
 * orchestration read model.
 *
 * @module ProjectionAutomationRepository
 */
import {
  AutomationId,
  AutomationLastRun,
  AutomationSchedule,
  IsoDateTime,
  ModelSelection,
  PositiveInt,
  ProjectId,
  RuntimeMode,
  ThreadEnvMode,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionAutomation = Schema.Struct({
  automationId: AutomationId,
  projectId: ProjectId,
  ownsProject: Schema.Boolean,
  title: Schema.String,
  prompt: Schema.String,
  schedule: AutomationSchedule,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  envMode: ThreadEnvMode,
  baseBranch: Schema.NullOr(Schema.String),
  startFromOrigin: Schema.Boolean,
  enabled: Schema.Boolean,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRun: Schema.NullOr(AutomationLastRun),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionAutomation = typeof ProjectionAutomation.Type;

export const GetProjectionAutomationInput = Schema.Struct({
  automationId: AutomationId,
});
export type GetProjectionAutomationInput = typeof GetProjectionAutomationInput.Type;

/**
 * The scheduler's queue read: enabled, undeleted automations whose next run is
 * at or before `dueAt`, soonest first.
 */
export const ListDueProjectionAutomationsInput = Schema.Struct({
  dueAt: IsoDateTime,
  limit: PositiveInt,
});
export type ListDueProjectionAutomationsInput = typeof ListDueProjectionAutomationsInput.Type;

/**
 * ProjectionAutomationRepositoryShape - Service API for projected automations.
 */
export interface ProjectionAutomationRepositoryShape {
  /** Insert or replace a projected automation row. Upserts by `automationId`. */
  readonly upsert: (
    automation: ProjectionAutomation,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: GetProjectionAutomationInput,
  ) => Effect.Effect<Option.Option<ProjectionAutomation>, ProjectionRepositoryError>;

  /** Every active automation, in creation order. */
  readonly listActive: () => Effect.Effect<
    ReadonlyArray<ProjectionAutomation>,
    ProjectionRepositoryError
  >;

  readonly listDue: (
    input: ListDueProjectionAutomationsInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionAutomation>, ProjectionRepositoryError>;

  /**
   * The soonest scheduled instant across active automations, or none when
   * nothing is scheduled. The scheduler sleeps against this rather than
   * polling every automation.
   */
  readonly getEarliestNextRunAt: () => Effect.Effect<
    Option.Option<string>,
    ProjectionRepositoryError
  >;
}

/**
 * ProjectionAutomationRepository - Service tag for automation projection persistence.
 */
export class ProjectionAutomationRepository extends Context.Service<
  ProjectionAutomationRepository,
  ProjectionAutomationRepositoryShape
>()("t3/persistence/Services/ProjectionAutomations/ProjectionAutomationRepository") {}
