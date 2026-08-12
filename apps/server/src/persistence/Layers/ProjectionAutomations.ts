import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import { AutomationLastRun, AutomationSchedule, ModelSelection } from "@vetra-studio/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionAutomationInput,
  ListDueProjectionAutomationsInput,
  ProjectionAutomation,
  ProjectionAutomationRepository,
  type ProjectionAutomationRepositoryShape,
} from "../Services/ProjectionAutomations.ts";

// SQLite has no boolean, so the three flags travel as 0/1 and convert in
// toProjectionAutomation — the same shape ProjectionThreadMessages uses for
// is_streaming.
const ProjectionAutomationDbRowSchema = ProjectionAutomation.mapFields(
  Struct.assign({
    ownsProject: Schema.Number,
    startFromOrigin: Schema.Number,
    enabled: Schema.Number,
    schedule: Schema.fromJsonString(AutomationSchedule),
    modelSelection: Schema.fromJsonString(ModelSelection),
    lastRun: Schema.NullOr(Schema.fromJsonString(AutomationLastRun)),
  }),
);

function toProjectionAutomation(
  row: Schema.Schema.Type<typeof ProjectionAutomationDbRowSchema>,
): ProjectionAutomation {
  return {
    automationId: row.automationId,
    projectId: row.projectId,
    ownsProject: row.ownsProject === 1,
    title: row.title,
    prompt: row.prompt,
    schedule: row.schedule,
    modelSelection: row.modelSelection,
    runtimeMode: row.runtimeMode,
    envMode: row.envMode,
    baseBranch: row.baseBranch,
    startFromOrigin: row.startFromOrigin === 1,
    enabled: row.enabled === 1,
    nextRunAt: row.nextRunAt,
    lastRun: row.lastRun,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

const EarliestNextRunRow = Schema.Struct({
  nextRunAt: Schema.NullOr(Schema.String),
});

const makeProjectionAutomationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionAutomationRow = SqlSchema.void({
    Request: ProjectionAutomation,
    execute: (row) =>
      sql`
        INSERT INTO projection_automations (
          automation_id,
          project_id,
          owns_project,
          title,
          prompt,
          schedule_json,
          model,
          runtime_mode,
          env_mode,
          base_branch,
          start_from_origin,
          enabled,
          next_run_at,
          last_run_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.automationId},
          ${row.projectId},
          ${row.ownsProject ? 1 : 0},
          ${row.title},
          ${row.prompt},
          ${JSON.stringify(row.schedule)},
          ${JSON.stringify(row.modelSelection)},
          ${row.runtimeMode},
          ${row.envMode},
          ${row.baseBranch},
          ${row.startFromOrigin ? 1 : 0},
          ${row.enabled ? 1 : 0},
          ${row.nextRunAt},
          ${row.lastRun === null ? null : JSON.stringify(row.lastRun)},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (automation_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          owns_project = excluded.owns_project,
          title = excluded.title,
          prompt = excluded.prompt,
          schedule_json = excluded.schedule_json,
          model = excluded.model,
          runtime_mode = excluded.runtime_mode,
          env_mode = excluded.env_mode,
          base_branch = excluded.base_branch,
          start_from_origin = excluded.start_from_origin,
          enabled = excluded.enabled,
          next_run_at = excluded.next_run_at,
          last_run_json = excluded.last_run_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionAutomationRow = SqlSchema.findOneOption({
    Request: GetProjectionAutomationInput,
    Result: ProjectionAutomationDbRowSchema,
    execute: ({ automationId }) =>
      sql`
        SELECT
          automation_id AS "automationId",
          project_id AS "projectId",
          owns_project AS "ownsProject",
          title,
          prompt,
          schedule_json AS "schedule",
          model AS "modelSelection",
          runtime_mode AS "runtimeMode",
          env_mode AS "envMode",
          base_branch AS "baseBranch",
          start_from_origin AS "startFromOrigin",
          enabled,
          next_run_at AS "nextRunAt",
          last_run_json AS "lastRun",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_automations
        WHERE automation_id = ${automationId}
      `,
  });

  const listActiveProjectionAutomationRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: ProjectionAutomationDbRowSchema,
    execute: () =>
      sql`
        SELECT
          automation_id AS "automationId",
          project_id AS "projectId",
          owns_project AS "ownsProject",
          title,
          prompt,
          schedule_json AS "schedule",
          model AS "modelSelection",
          runtime_mode AS "runtimeMode",
          env_mode AS "envMode",
          base_branch AS "baseBranch",
          start_from_origin AS "startFromOrigin",
          enabled,
          next_run_at AS "nextRunAt",
          last_run_json AS "lastRun",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_automations
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC, automation_id ASC
      `,
  });

  const listDueProjectionAutomationRows = SqlSchema.findAll({
    Request: ListDueProjectionAutomationsInput,
    Result: ProjectionAutomationDbRowSchema,
    execute: ({ dueAt, limit }) =>
      sql`
        SELECT
          automation_id AS "automationId",
          project_id AS "projectId",
          owns_project AS "ownsProject",
          title,
          prompt,
          schedule_json AS "schedule",
          model AS "modelSelection",
          runtime_mode AS "runtimeMode",
          env_mode AS "envMode",
          base_branch AS "baseBranch",
          start_from_origin AS "startFromOrigin",
          enabled,
          next_run_at AS "nextRunAt",
          last_run_json AS "lastRun",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_automations
        WHERE deleted_at IS NULL
          AND enabled = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= ${dueAt}
        ORDER BY next_run_at ASC, automation_id ASC
        LIMIT ${limit}
      `,
  });

  const getEarliestNextRunAtRow = SqlSchema.findOneOption({
    Request: Schema.Struct({}),
    Result: EarliestNextRunRow,
    execute: () =>
      sql`
        SELECT MIN(next_run_at) AS "nextRunAt"
        FROM projection_automations
        WHERE deleted_at IS NULL
          AND enabled = 1
          AND next_run_at IS NOT NULL
      `,
  });

  const upsert: ProjectionAutomationRepositoryShape["upsert"] = (row) =>
    upsertProjectionAutomationRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRepository.upsert:query")),
    );

  const getById: ProjectionAutomationRepositoryShape["getById"] = (input) =>
    getProjectionAutomationRow(input).pipe(
      Effect.map(Option.map(toProjectionAutomation)),
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRepository.getById:query")),
    );

  const listActive: ProjectionAutomationRepositoryShape["listActive"] = () =>
    listActiveProjectionAutomationRows({}).pipe(
      Effect.map((rows) => rows.map(toProjectionAutomation)),
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRepository.listActive:query")),
    );

  const listDue: ProjectionAutomationRepositoryShape["listDue"] = (input) =>
    listDueProjectionAutomationRows(input).pipe(
      Effect.map((rows) => rows.map(toProjectionAutomation)),
      Effect.mapError(toPersistenceSqlError("ProjectionAutomationRepository.listDue:query")),
    );

  // MIN() over an empty set still yields one row, holding null — so "nothing
  // scheduled" arrives as Some({nextRunAt: null}), not None.
  const getEarliestNextRunAt: ProjectionAutomationRepositoryShape["getEarliestNextRunAt"] = () =>
    getEarliestNextRunAtRow({}).pipe(
      Effect.map(Option.flatMap((row) => Option.fromNullOr(row.nextRunAt))),
      Effect.mapError(
        toPersistenceSqlError("ProjectionAutomationRepository.getEarliestNextRunAt:query"),
      ),
    );

  return {
    upsert,
    getById,
    listActive,
    listDue,
    getEarliestNextRunAt,
  } satisfies ProjectionAutomationRepositoryShape;
});

export const ProjectionAutomationRepositoryLive = Layer.effect(
  ProjectionAutomationRepository,
  makeProjectionAutomationRepository,
);
