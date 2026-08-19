import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as PowerhouseProject from "./PowerhouseProject.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(PowerhouseProject.layer.pipe(Layer.provide(WorkspacePaths.layer))),
  Layer.provideMerge(NodeServices.layer),
);

/** Fixture files are written as JSON text on purpose; no codec is involved. */
const asJson = (value: unknown): string => JSON.stringify(value);

const MODEL_JSON = asJson({
  id: "powerhouse/todo",
  name: "Todo",
  extension: "todo",
  description: "A todo list",
  specifications: [
    {
      version: 1,
      changeLog: [],
      state: {
        global: { schema: "type TodoState { id: ID! }" },
        local: { schema: "" },
      },
      modules: [
        { name: "base", operations: [{ name: "ADD_TODO", schema: "input AddTodo { x: String }" }] },
      ],
    },
  ],
});

const writeFile = Effect.fn(function* (root: string, relativePath: string, contents: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(root, relativePath);
  yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
  yield* fileSystem.writeFileString(absolutePath, contents);
});

/**
 * A fixture Powerhouse project on disk. No Powerhouse install involved: the
 * layout is the whole contract.
 */
const makeProject = Effect.fn(function* (options?: {
  readonly config?: string | null;
  readonly models?: Readonly<Record<string, string>>;
  readonly modelsDir?: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vetra-powerhouse-test-" });
  if (options?.config !== null) {
    yield* writeFile(root, "powerhouse.config.json", options?.config ?? "{}");
  }
  const modelsDir = options?.modelsDir ?? "document-models";
  for (const [name, contents] of Object.entries(options?.models ?? { todo: MODEL_JSON })) {
    yield* writeFile(root, `${modelsDir}/${name}/${name}.json`, contents);
  }
  return root;
});

describe("PowerhouseProject", () => {
  it.layer(TestLayer)("document models", (it) => {
    it.effect("lists models from the default directory", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject();
        const listing = yield* project.listDocumentModels({ cwd: root });
        expect(listing.documentModelsDir).toBe("./document-models");
        expect(listing.truncated).toBe(false);
        expect(listing.failures).toEqual([]);
        expect(listing.models).toHaveLength(1);
        expect(listing.models[0]).toMatchObject({
          directoryName: "todo",
          name: "Todo",
          extension: "todo",
          specCount: 1,
          latestVersion: 1,
          moduleCount: 1,
          operationCount: 1,
        });
      }),
    );

    it.effect("honors a configured documentModelsDir", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({
          config: asJson({ documentModelsDir: "./custom/models" }),
          modelsDir: "custom/models",
        });
        const listing = yield* project.listDocumentModels({ cwd: root });
        expect(listing.documentModelsDir).toBe("./custom/models");
        expect(listing.models.map((model) => model.directoryName)).toEqual(["todo"]);
      }),
    );

    it.effect("falls back to defaults when the config cannot be parsed", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({ config: "{ not json" });
        const listing = yield* project.listDocumentModels({ cwd: root });
        expect(listing.documentModelsDir).toBe("./document-models");
        expect(listing.models).toHaveLength(1);
      }),
    );

    it.effect("fails as not_a_powerhouse_project without a config file", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({ config: null });
        const error = yield* project.listDocumentModels({ cwd: root }).pipe(Effect.flip);
        expect(error.failure).toBe("not_a_powerhouse_project");
      }),
    );

    it.effect("treats Connect's same-named runtime config as not a project", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({
          config: asJson({ schemaVersion: 2, localPackage: "./x" }),
        });
        const error = yield* project.listDocumentModels({ cwd: root }).pipe(Effect.flip);
        expect(error.failure).toBe("not_a_powerhouse_project");
      }),
    );

    it.effect("reports a missing models directory distinctly from an empty one", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({ models: {} });
        const error = yield* project.listDocumentModels({ cwd: root }).pipe(Effect.flip);
        expect(error.failure).toBe("models_dir_missing");
      }),
    );

    it.effect("rejects a documentModelsDir that escapes the workspace", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({
          config: asJson({ documentModelsDir: "../elsewhere" }),
        });
        const error = yield* project.listDocumentModels({ cwd: root }).pipe(Effect.flip);
        expect(error.failure).toBe("models_dir_missing");
      }),
    );

    it.effect("keeps listing when one model file is broken", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({
          models: { todo: MODEL_JSON, broken: "{ not json", shapeless: asJson({ a: 1 }) },
        });
        const listing = yield* project.listDocumentModels({ cwd: root });
        expect(listing.models.map((model) => model.directoryName)).toEqual(["todo"]);
        expect(listing.failures).toEqual(
          expect.arrayContaining([
            { directoryName: "broken", reason: "invalid_json" },
            { directoryName: "shapeless", reason: "invalid_shape" },
          ]),
        );
      }),
    );

    it.effect("reports a model file that is too large for the websocket payload", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({
          models: { oversized: "x".repeat(2 * 1024 * 1024 + 1) },
        });
        const listing = yield* project.listDocumentModels({ cwd: root });
        expect(listing.models).toEqual([]);
        expect(listing.failures).toEqual([{ directoryName: "oversized", reason: "too_large" }]);
      }),
    );

    it.effect("rejects a models directory symlink that escapes the project", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* makeProject({
          config: asJson({ documentModelsDir: "./linked-models" }),
          models: {},
        });
        const outside = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "vetra-powerhouse-outside-",
        });
        yield* fileSystem.symlink(outside, path.join(root, "linked-models"));
        const error = yield* project.listDocumentModels({ cwd: root }).pipe(Effect.flip);
        expect(error.failure).toBe("models_dir_missing");
      }),
    );

    it.effect("ignores a model directory whose file does not match its name", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({ models: {} });
        yield* writeFile(root, "document-models/todo/other.json", MODEL_JSON);
        const listing = yield* project.listDocumentModels({ cwd: root });
        expect(listing.models).toEqual([]);
        expect(listing.failures).toEqual([{ directoryName: "todo", reason: "missing_json" }]);
      }),
    );

    it.effect("ignores stray files beside the model directories", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject();
        yield* writeFile(root, "document-models/README.md", "# models");
        const listing = yield* project.listDocumentModels({ cwd: root });
        expect(listing.models.map((model) => model.directoryName)).toEqual(["todo"]);
        expect(listing.failures).toEqual([]);
      }),
    );

    it.effect("ignores directory names that cannot round-trip through the model contract", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({ models: { todo: MODEL_JSON, "   ": MODEL_JSON } });
        const listing = yield* project.listDocumentModels({ cwd: root });
        expect(listing.models.map((model) => model.directoryName)).toEqual(["todo"]);
        expect(listing.failures).toEqual([]);
      }),
    );

    it.effect("returns a model in full, including per-operation SDL", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject();
        const model = yield* project.getDocumentModel({ cwd: root, directoryName: "todo" });
        expect(model.id).toBe("powerhouse/todo");
        expect(model.specifications[0]?.globalSchema).toBe("type TodoState { id: ID! }");
        expect(model.specifications[0]?.modules[0]?.operations[0]?.schema).toBe(
          "input AddTodo { x: String }",
        );
      }),
    );

    it.effect.each(["../secrets", "nested/todo", "..", "."])(
      "rejects %s as a model name",
      (directoryName) =>
        Effect.gen(function* () {
          const project = yield* PowerhouseProject.PowerhouseProject;
          const root = yield* makeProject();
          const error = yield* project
            .getDocumentModel({ cwd: root, directoryName })
            .pipe(Effect.flip);
          expect(error.failure).toBe("invalid_model_name");
        }),
    );

    it.effect("reports an unknown model as model_not_found", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject();
        const error = yield* project
          .getDocumentModel({ cwd: root, directoryName: "nope" })
          .pipe(Effect.flip);
        expect(error.failure).toBe("model_not_found");
      }),
    );
  });

  it.layer(TestLayer)("project discovery", (it) => {
    it.effect("finds the workspace root when it is the project", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({ config: asJson({ reactor: { port: 4444 } }) });
        const projects = yield* project.listProjects(root);
        expect(projects).toHaveLength(1);
        expect(projects[0]).toMatchObject({
          path: "",
          documentModelsDir: "./document-models",
          reactorPort: 4444,
          configValid: true,
        });
      }),
    );

    it.effect("finds a project nested in a monorepo app directory", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "vetra-powerhouse-mono-",
        });
        yield* writeFile(root, "package.json", asJson({ name: "monorepo" }));
        yield* writeFile(root, "apps/connect/powerhouse.config.json", asJson({}));
        yield* writeFile(root, "apps/connect/document-models/todo/todo.json", MODEL_JSON);
        yield* writeFile(root, "apps/portal/package.json", asJson({ name: "portal" }));
        yield* writeFile(root, "packages/ui/package.json", asJson({ name: "ui" }));

        const projects = yield* project.listProjects(root);
        expect(projects.map((entry) => entry.path)).toEqual(["apps/connect"]);
        expect(projects[0]?.name).toBe("connect");

        // The models of a nested project are reachable through the same path.
        const listing = yield* project.listDocumentModels({
          cwd: root,
          projectPath: "apps/connect",
        });
        expect(listing.models.map((model) => model.name)).toEqual(["Todo"]);
      }),
    );

    it.effect("finds every project in a workspace with several", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "vetra-powerhouse-multi-",
        });
        yield* writeFile(root, "apps/connect/powerhouse.config.json", asJson({}));
        yield* writeFile(root, "apps/studio/powerhouse.config.json", asJson({}));
        const projects = yield* project.listProjects(root);
        expect(projects.map((entry) => entry.path)).toEqual(["apps/connect", "apps/studio"]);
      }),
    );

    it.effect("returns nothing for a workspace that has no Powerhouse project", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vetra-plain-repo-" });
        yield* writeFile(root, "apps/web/package.json", asJson({ name: "web" }));
        expect(yield* project.listProjects(root)).toEqual([]);
      }),
    );

    it.effect("does not descend into node_modules or build output", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "vetra-powerhouse-skip-",
        });
        yield* writeFile(root, "node_modules/@acme/pkg/powerhouse.config.json", asJson({}));
        yield* writeFile(root, "dist/bundle/powerhouse.config.json", asJson({}));
        yield* writeFile(root, ".git/hooks/powerhouse.config.json", asJson({}));
        expect(yield* project.listProjects(root)).toEqual([]);
      }),
    );

    it.effect("stops at a project rather than walking into its own directories", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "vetra-powerhouse-stop-",
        });
        yield* writeFile(root, "powerhouse.config.json", asJson({}));
        yield* writeFile(root, "vendored/inner/powerhouse.config.json", asJson({}));
        expect((yield* project.listProjects(root)).map((entry) => entry.path)).toEqual([""]);
      }),
    );

    it.effect("skips a Connect runtime config that shares the file name", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vetra-powerhouse-rt-" });
        yield* writeFile(
          root,
          "apps/built/powerhouse.config.json",
          asJson({ schemaVersion: 2, localPackage: "./dist" }),
        );
        expect(yield* project.listProjects(root)).toEqual([]);
      }),
    );

    it.effect("reports a project whose config does not parse, using defaults", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vetra-powerhouse-bad-" });
        yield* writeFile(root, "apps/connect/powerhouse.config.json", "{ not json");
        const projects = yield* project.listProjects(root);
        expect(projects).toHaveLength(1);
        expect(projects[0]).toMatchObject({
          path: "apps/connect",
          configValid: false,
          documentModelsDir: "./document-models",
          reactorPort: null,
        });
      }),
    );

    it.effect("rejects a project path that escapes the workspace", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject();
        const error = yield* project
          .listDocumentModels({ cwd: root, projectPath: "../elsewhere" })
          .pipe(Effect.flip);
        expect(error.failure).toBe("invalid_project_path");
      }),
    );
  });

  it.layer(TestLayer)("config", (it) => {
    it.effect("reads the reactor port the panel probes", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({
          config: asJson({ reactor: { port: 4444 }, studio: { port: 3000 } }),
        });
        expect(yield* project.readConfig({ cwd: root })).toEqual({ reactorPort: 4444 });
      }),
    );

    it.effect("drops a reactor port of the wrong type instead of failing", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const root = yield* makeProject({
          config: asJson({ reactor: { port: "4001" }, storage: "memory" }),
        });
        expect(yield* project.readConfig({ cwd: root })).toEqual({});
      }),
    );

    it.effect("reports an unreadable config shape instead of treating it as missing", () =>
      Effect.gen(function* () {
        const project = yield* PowerhouseProject.PowerhouseProject;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "vetra-powerhouse-config-directory-",
        });
        yield* fileSystem.makeDirectory(path.join(root, "powerhouse.config.json"));

        const error = yield* project.listProjects(root).pipe(Effect.flip);
        expect(error.failure).toBe("read_failed");
      }),
    );
  });
});
