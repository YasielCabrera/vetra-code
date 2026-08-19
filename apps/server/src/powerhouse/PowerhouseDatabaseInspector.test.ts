import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as PowerhouseDatabaseInspector from "./PowerhouseDatabaseInspector.ts";
import * as PowerhouseProject from "./PowerhouseProject.ts";

const ProjectLayer = PowerhouseProject.layer.pipe(Layer.provide(WorkspacePaths.layer));
const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(PowerhouseDatabaseInspector.layer.pipe(Layer.provide(ProjectLayer))),
  Layer.provideMerge(NodeServices.layer),
);

const writeFile = Effect.fn(function* (root: string, relativePath: string, contents: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(root, relativePath);
  yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
  yield* fileSystem.writeFileString(absolutePath, contents);
});

const makeProject = Effect.fn(function* (input?: {
  readonly projectPath?: string;
  readonly env?: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspace = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "vetra-powerhouse-database-test-",
  });
  const projectPath = input?.projectPath ?? "";
  const projectDirectory = projectPath.length === 0 ? workspace : path.join(workspace, projectPath);
  yield* writeFile(projectDirectory, "powerhouse.config.json", "{}");
  if (input?.env !== undefined) yield* writeFile(projectDirectory, ".env", input.env);
  return { workspace, projectDirectory, projectPath };
});

const targetText = (targets: ReadonlyArray<Record<string, unknown>>) =>
  targets
    .flatMap((target) => Object.values(target))
    .filter((value): value is string => typeof value === "string")
    .join(" ");

describe("PowerhouseDatabaseInspector", () => {
  it.layer(TestLayer)("discovery", (it) => {
    it.effect("discovers both default stores and explains CLI-only paths", () =>
      Effect.gen(function* () {
        const inspector = yield* PowerhouseDatabaseInspector.PowerhouseDatabaseInspector;
        const project = yield* makeProject();
        const result = yield* inspector.discover({ cwd: project.workspace });
        expect(result.targets.map((target) => [target.id, target.status, target.source])).toEqual([
          ["read_models", "missing", "default"],
          ["reactor", "missing", "default"],
        ]);
        expect(result.targets[0]?.detail).toContain("--db-path");
        expect(result.targets[1]?.detail).toContain("PH_REACTOR_DATABASE_URL");
      }),
    );

    it.effect("preserves actionable database failure messages", () =>
      Effect.gen(function* () {
        const inspector = yield* PowerhouseDatabaseInspector.PowerhouseDatabaseInspector;
        const project = yield* makeProject();
        const error = yield* Effect.flip(
          inspector.catalog({ cwd: project.workspace, target: "read_models" }),
        );

        expect(error).toMatchObject({ failure: "missing", target: "read_models" });
        expect(error.message).toContain("--db-path");
      }),
    );

    it.effect("resolves a nested Powerhouse project without exposing its path", () =>
      Effect.gen(function* () {
        const inspector = yield* PowerhouseDatabaseInspector.PowerhouseDatabaseInspector;
        const project = yield* makeProject({
          projectPath: "apps/connect",
          env: "DATABASE_URL=../outside-project\n",
        });
        const result = yield* inspector.discover({
          cwd: project.workspace,
          projectPath: project.projectPath,
        });
        const readModels = result.targets.find((target) => target.id === "read_models");
        expect(readModels).toMatchObject({
          backend: "pglite_snapshot",
          status: "unsupported",
          source: "project_env",
        });
        expect(targetText(result.targets)).not.toContain(project.projectDirectory);
        expect(targetText(result.targets)).not.toContain("outside-project");
      }),
    );

    it.effect(
      "allows loopback Postgres and rejects remote Postgres without leaking credentials",
      () =>
        Effect.gen(function* () {
          const inspector = yield* PowerhouseDatabaseInspector.PowerhouseDatabaseInspector;
          const project = yield* makeProject({
            env: [
              "DATABASE_URL=postgres://local-user:local-secret@127.0.0.1:5432/read_models",
              "PH_REACTOR_DATABASE_URL=postgres://remote-user:remote-secret@database.example.com/reactor",
            ].join("\n"),
          });
          const result = yield* inspector.discover({ cwd: project.workspace });
          expect(result.targets[0]).toMatchObject({
            id: "read_models",
            backend: "postgres",
            status: "ready",
            source: "project_env",
          });
          expect(result.targets[1]).toMatchObject({
            id: "reactor",
            backend: "postgres",
            status: "unsupported",
            source: "project_env",
          });
          const publicText = targetText(result.targets);
          expect(publicText).not.toContain("local-secret");
          expect(publicText).not.toContain("remote-secret");
          expect(publicText).not.toContain("database.example.com");
        }),
    );

    it.effect("uses the Vetra server environment before the project .env", () =>
      Effect.gen(function* () {
        const inspector = yield* PowerhouseDatabaseInspector.PowerhouseDatabaseInspector;
        const project = yield* makeProject({
          env: "DATABASE_URL=postgres://project:secret@database.example.com/read_models\n",
        });
        const previous = process.env.DATABASE_URL;
        process.env.DATABASE_URL = "postgres://server:secret@localhost/read_models";
        try {
          const result = yield* inspector.discover({ cwd: project.workspace });
          expect(result.targets[0]).toMatchObject({
            backend: "postgres",
            status: "ready",
            source: "server_env",
          });
          expect(targetText(result.targets)).not.toContain("secret");
        } finally {
          if (previous === undefined) delete process.env.DATABASE_URL;
          else process.env.DATABASE_URL = previous;
        }
      }),
    );

    it.effect("treats explicitly empty database settings like Powerhouse defaults", () =>
      Effect.gen(function* () {
        const inspector = yield* PowerhouseDatabaseInspector.PowerhouseDatabaseInspector;
        const project = yield* makeProject({
          env: [
            "DATABASE_URL=",
            "PH_REACTOR_DATABASE_URL=",
            "PH_SWITCHBOARD_DATABASE_URL=postgres://ignored@localhost/shared",
          ].join("\n"),
        });
        const result = yield* inspector.discover({ cwd: project.workspace });
        expect(result.targets.map((target) => [target.id, target.status, target.source])).toEqual([
          ["read_models", "missing", "default"],
          ["reactor", "missing", "default"],
        ]);
      }),
    );
  });
});
