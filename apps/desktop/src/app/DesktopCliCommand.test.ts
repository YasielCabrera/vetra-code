import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopCliCommand from "./DesktopCliCommand.ts";
import * as DesktopCliShim from "./DesktopCliShim.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const environmentFor = (
  path: Path.Path,
  input: { home: string; baseDir: string; platform?: NodeJS.Platform; isPackaged?: boolean },
) =>
  DesktopEnvironment.DesktopEnvironment.of({
    path,
    platform: input.platform ?? "linux",
    isPackaged: input.isPackaged ?? true,
    homeDirectory: input.home,
    baseDir: input.baseDir,
    stateDir: path.join(input.baseDir, "userdata"),
    desktopSettingsPath: path.join(input.baseDir, "userdata", "desktop-settings.json"),
    serverRoot: "/opt/Vetra Code/resources/app.asar",
    appImagePath: Option.none(),
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);

const commandIn = (
  input: {
    home: string;
    baseDir?: string;
    platform?: NodeJS.Platform;
    isPackaged?: boolean;
    env?: NodeJS.ProcessEnv;
  },
  spawner?: ChildProcessSpawner.ChildProcessSpawner["Service"],
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const baseDir = input.baseDir ?? path.join(input.home, ".vetra-code");
    yield* fs.makeDirectory(path.join(baseDir, "userdata"), { recursive: true });
    const make = DesktopCliCommand.make.pipe(
      Effect.provideService(
        DesktopEnvironment.DesktopEnvironment,
        environmentFor(path, { ...input, baseDir }),
      ),
      Effect.provideService(HostProcess.Environment, input.env ?? { PATH: "", SHELL: "/bin/zsh" }),
    );
    return yield* spawner
      ? make.pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
      : make;
  });

/** `inherited` stands in for the app's own environment, which `extendEnv` passes on. */
const fakePowerShell = (initial: string, inherited: Record<string, string> = {}) => {
  const registry = { path: initial, failReads: false, writes: 0 };
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      const { options } = command as unknown as {
        readonly options: { readonly env?: Record<string, string>; readonly extendEnv?: boolean };
      };
      const env = { ...(options.extendEnv ? inherited : {}), ...options.env };
      let exitCode = 0;
      let stdout = "";
      if (env.VETRA_SET === "1") {
        registry.path = env.VETRA_PATH ?? "";
        registry.writes += 1;
      } else if (registry.failReads) {
        exitCode = 1;
      } else {
        stdout = Buffer.from(registry.path, "utf8").toString("base64");
      }
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.make(new TextEncoder().encode(stdout)),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );
  return { registry, spawner };
};

it.layer(NodeServices.layer)("DesktopCliCommand", (it) => {
  it.effect("links the launcher onto PATH and removes only that link", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { PATH: "", SHELL: "/bin/zsh" };
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const command = yield* commandIn({ home, env });
      const link = path.join(home, ".local", "bin", "vetra");

      expect(yield* command.state).toEqual({
        supported: true,
        installedPath: null,
        onPath: false,
        launcherPath: null,
      });
      yield* command.installOnFirstLaunch;
      expect((yield* command.state).installedPath).toBe(link);
      const installed = yield* command.install;
      expect(installed.installedPath).toBe(link);
      expect(installed.launcherPath).toBe(path.join(home, ".vetra-code", "bin", "vetra"));
      expect(installed.pathSetup).toEqual({ file: "~/.zshrc", added: false });
      expect(yield* fs.readLink(link)).toBe(path.join(home, ".vetra-code", "bin", "vetra"));
      expect((yield* command.install).installedPath).toBe(link);

      // Add to PATH appends one line, once, and keeps a final line with no newline intact.
      const zshrc = path.join(home, ".zshrc");
      yield* fs.writeFileString(zshrc, "# mine");
      // A folder already on PATH needs nothing.
      env.PATH = path.join(home, ".local", "bin");
      yield* command.addToPath;
      expect(yield* fs.readFileString(zshrc)).toBe("# mine");
      env.PATH = "";
      yield* Effect.all([command.addToPath, command.addToPath], { concurrency: "unbounded" });
      expect((yield* command.addToPath).pathSetup).toEqual({ file: "~/.zshrc", added: true });
      expect(yield* fs.readFileString(zshrc)).toBe(
        '# mine\n# Added by Vetra Code\nexport PATH="$PATH:$HOME/.local/bin"\n',
      );

      expect((yield* command.uninstall).installedPath).toBeNull();
      expect(yield* fs.exists(link)).toBe(false);
      expect(yield* fs.exists(path.join(home, ".vetra-code", "bin", "vetra"))).toBe(true);
      // Removed stays removed: first launch never installs again.
      yield* command.installOnFirstLaunch;
      expect(yield* fs.exists(link)).toBe(false);

      // Also when first launch was put off (no shell PATH yet) and the user removed it meanwhile.
      const laterHome = yield* fs.makeTempDirectoryScoped();
      const later = yield* commandIn({ home: laterHome, env });
      yield* later.install;
      yield* later.uninstall;
      yield* later.installOnFirstLaunch;
      expect(yield* fs.exists(path.join(laterHome, ".local", "bin", "vetra"))).toBe(false);

      // An app that ran before left its settings or launcher. Its user may have removed vetra or
      // chosen another, so first launch leaves it to Settings, where Install still works.
      for (const left of ["userdata/desktop-settings.json", "bin/vetra"]) {
        const upgradedHome = yield* fs.makeTempDirectoryScoped();
        const leftFile = path.join(upgradedHome, ".vetra-code", left);
        yield* fs.makeDirectory(path.dirname(leftFile), { recursive: true });
        yield* fs.writeFileString(leftFile, `#!/bin/sh\n# ${DesktopCliShim.MARKER}\n`);
        const upgraded = yield* commandIn({ home: upgradedHome, env });
        yield* upgraded.installOnFirstLaunch;
        const upgradedLink = path.join(upgradedHome, ".local", "bin", "vetra");
        expect(yield* fs.exists(upgradedLink)).toBe(false);
        expect((yield* upgraded.install).installedPath).toBe(upgradedLink);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("never replaces or removes a vetra it did not create", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { PATH: "", SHELL: "/bin/zsh" };
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const command = yield* commandIn({ home, env });
      const theirs = path.join(home, ".local", "bin", "vetra");
      yield* fs.makeDirectory(path.dirname(theirs), { recursive: true });
      yield* fs.writeFileString(theirs, "npm's vetra\n");
      // Even a broken link in the next folder is someone else's.
      yield* fs.makeDirectory(path.join(home, "bin"), { recursive: true });
      yield* fs.symlink(path.join(home, "gone"), path.join(home, "bin", "vetra"));

      const error = yield* Effect.flip(command.install);
      expect(error.message).toContain("Another vetra command is already in");
      yield* command.uninstall;
      expect(yield* fs.readFileString(theirs)).toBe("npm's vetra\n");
      expect(yield* fs.readLink(path.join(home, "bin", "vetra"))).toBe(path.join(home, "gone"));

      // A fresh install beside someone else's vetra (even off PATH or a dangling link) adds no second
      // vetra in ~/bin.
      for (const dangling of [false, true]) {
        const besideHome = yield* fs.makeTempDirectoryScoped();
        const other = path.join(besideHome, ".local", "bin", "vetra");
        yield* fs.makeDirectory(path.dirname(other), { recursive: true });
        yield* dangling
          ? fs.symlink(path.join(besideHome, "gone"), other)
          : fs.writeFileString(other, "npm's vetra\n");
        yield* (yield* commandIn({ home: besideHome })).installOnFirstLaunch;
        expect(yield* fs.exists(path.join(besideHome, "bin", "vetra"))).toBe(false);
      }

      const launcher = path.join(home, ".vetra-code", "bin", "vetra");
      yield* fs.writeFileString(launcher, "npm's vetra\n");
      env.PATH = path.dirname(launcher);
      expect(yield* command.state).toMatchObject({ onPath: false, shadowedBy: launcher });
      expect((yield* Effect.flip(command.install)).message).toContain("Could not set up");
      yield* command.uninstall;
      expect(yield* fs.readFileString(launcher)).toBe("npm's vetra\n");
    }).pipe(Effect.scoped),
  );

  it.effect("installs beside an upstream t3 command without touching it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const t3Launcher = path.join(home, ".vetra-code", "bin", "t3");
      yield* fs.makeDirectory(path.dirname(t3Launcher), { recursive: true });
      yield* fs.writeFileString(
        t3Launcher,
        "#!/bin/sh\n# Written by Vetra Code: runs the desktop app's bundled t3 CLI.\n",
      );
      const t3Link = path.join(home, ".local", "bin", "t3");
      yield* fs.makeDirectory(path.dirname(t3Link), { recursive: true });
      yield* fs.symlink(t3Launcher, t3Link);
      const command = yield* commandIn({ home });

      expect((yield* command.install).installedPath).toBe(
        path.join(home, ".local", "bin", "vetra"),
      );
      yield* command.uninstall;
      expect(yield* fs.readLink(t3Link)).toBe(t3Launcher);
    }).pipe(Effect.scoped),
  );

  it.effect("finds and removes a link left by a previous Vetra home", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { PATH: "", SHELL: "/bin/zsh" };
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const before = yield* commandIn({ home, baseDir: path.join(home, "old-vetra"), env });
      const link = (yield* before.install).installedPath;

      const after = yield* commandIn({ home, baseDir: path.join(home, "new-vetra"), env });
      // A first launch leaves another home's command alone; only Install takes it over.
      yield* after.installOnFirstLaunch;
      expect(yield* fs.readLink(link!)).toBe(path.join(home, "old-vetra", "bin", "vetra"));
      // On PATH, it runs the other home's launcher. Settings offers Install (not Remove, and not
      // "another vetra runs first"), which updates that link in place.
      env.PATH = path.dirname(link!);
      expect(yield* after.state).toMatchObject({ installedPath: null, onPath: false });
      expect((yield* after.state).shadowedBy).toBeUndefined();
      env.PATH = "";
      // Off PATH, Add to PATH would expose the other home's command, not this one.
      expect((yield* after.state).pathSetup).toBeUndefined();
      yield* Effect.flip(after.addToPath);
      expect(yield* fs.exists(path.join(home, ".zshrc"))).toBe(false);
      // Behind another vetra the install fails, and the old link still works.
      const shadow = path.join(home, "shadow");
      yield* fs.makeDirectory(shadow);
      yield* fs.writeFileString(path.join(shadow, "vetra"), "#!/bin/sh\n", { mode: 0o755 });
      env.PATH = shadow;
      yield* Effect.flip(after.install);
      expect(yield* fs.readLink(link!)).toBe(path.join(home, "old-vetra", "bin", "vetra"));
      // Install takes it over, also with its folder first on PATH.
      env.PATH = path.dirname(link!);
      expect((yield* after.install).installedPath).toBe(link);
      expect(yield* fs.readLink(link!)).toBe(path.join(home, "new-vetra", "bin", "vetra"));
      env.PATH = "";
      yield* after.uninstall;
      expect(yield* fs.exists(path.join(home, ".local", "bin", "vetra"))).toBe(false);
      expect(yield* fs.exists(path.join(home, "bin", "vetra"))).toBe(false);

      // A folder already on PATH wins, even written with a trailing slash.
      env.PATH = `${path.join(home, "bin")}/`;
      expect((yield* after.install).installedPath).toBe(path.join(home, "bin", "vetra"));

      // An old link of ours is updated where it is, not moved to a folder that may be off PATH.
      yield* fs.writeFileString(path.join(home, "bin", "vetra.staging"), "mine");
      yield* fs.remove(path.join(home, "bin", "vetra"));
      yield* fs.symlink(
        path.join(home, "old-vetra", "bin", "vetra"),
        path.join(home, "bin", "vetra"),
      );
      env.PATH = "";
      expect((yield* after.install).installedPath).toBe(path.join(home, "bin", "vetra"));
      expect(yield* fs.readLink(path.join(home, "bin", "vetra"))).toBe(
        path.join(home, "new-vetra", "bin", "vetra"),
      );
      expect(yield* fs.exists(path.join(home, ".local", "bin", "vetra"))).toBe(false);
      expect(yield* fs.readFileString(path.join(home, "bin", "vetra.staging"))).toBe("mine");
    }).pipe(Effect.scoped),
  );

  it.effect("refuses to install behind another vetra that runs first", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { PATH: "", SHELL: "/bin/zsh" };
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const shadow = path.join(home, "shadow");
      yield* fs.makeDirectory(shadow);
      yield* fs.writeFileString(path.join(shadow, "vetra"), "#!/bin/sh\n", { mode: 0o755 });
      env.PATH = [shadow, `${path.join(home, ".local", "bin")}/`].join(":");

      const command = yield* commandIn({ home, env });
      const theirs = path.join(shadow, "vetra");
      expect((yield* command.state).shadowedBy).toBe(theirs);
      const error = yield* Effect.flip(command.install);
      expect(error.message).toContain(theirs);
      yield* command.installOnFirstLaunch;
      expect(yield* fs.exists(path.join(home, ".local", "bin", "vetra"))).toBe(false);
      expect(yield* fs.readFileString(theirs)).toBe("#!/bin/sh\n");

      // Its folder is already on PATH behind theirs; adding it again would change which vetra runs.
      yield* fs.makeDirectory(path.join(home, ".local", "bin"), { recursive: true });
      yield* fs.symlink(
        path.join(home, ".vetra-code", "bin", "vetra"),
        path.join(home, ".local", "bin", "vetra"),
      );
      const behind = yield* command.state;
      expect(behind.installedPath).toBe(path.join(home, ".local", "bin", "vetra"));
      expect(behind.pathSetup).toBeUndefined();
      // Off PATH behind theirs, adding the folder would still put ours first.
      env.PATH = shadow;
      expect((yield* command.state).pathSetup).toBeUndefined();
      yield* Effect.flip(command.addToPath);
      expect(yield* fs.exists(path.join(home, ".zshrc"))).toBe(false);
      env.PATH = [shadow, `${path.join(home, ".local", "bin")}/`].join(":");
      yield* fs.remove(path.join(home, ".local", "bin", "vetra"));

      // A first-launch install that failed is not retried behind the user's back.
      yield* fs.remove(theirs);
      yield* command.installOnFirstLaunch;
      expect(yield* fs.exists(path.join(home, ".local", "bin", "vetra"))).toBe(false);
      const installed = yield* command.install;
      expect(installed).toMatchObject({
        onPath: true,
        installedPath: path.join(home, ".local", "bin", "vetra"),
      });
      expect(installed.shadowedBy).toBeUndefined();
    }).pipe(Effect.scoped),
  );

  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "skips a vetra directory or a file this user cannot execute",
    () =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { PATH: "", SHELL: "/bin/zsh" };
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const folder = path.join(home, "folder");
        const plain = path.join(home, "plain");
        const shadow = path.join(home, "shadow");
        yield* fs.makeDirectory(path.join(folder, "vetra"), { recursive: true });
        yield* fs.makeDirectory(plain);
        yield* fs.writeFileString(path.join(plain, "vetra"), "notes\n");
        // Root can execute mode 0o601; other users must honor the owner permissions.
        yield* fs.chmod(path.join(plain, "vetra"), process.getuid?.() === 0 ? 0o600 : 0o601);
        yield* fs.makeDirectory(shadow);
        yield* fs.writeFileString(path.join(shadow, "vetra"), "#!/bin/sh\n", { mode: 0o755 });
        env.PATH = [folder, plain, shadow, path.join(home, ".local", "bin")].join(":");

        const command = yield* commandIn({ home, env });
        expect((yield* command.state).shadowedBy).toBe(path.join(shadow, "vetra"));

        const error = yield* Effect.flip(command.install);
        expect(error.message).toContain(path.join(shadow, "vetra"));

        yield* fs.remove(shadow, { recursive: true });
        expect(yield* command.install).toMatchObject({
          onPath: true,
          installedPath: path.join(home, ".local", "bin", "vetra"),
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "does not treat its own launcher as another vetra when its folder is first on PATH",
    () =>
      Effect.gen(function* () {
        const env: NodeJS.ProcessEnv = { PATH: "", SHELL: "/bin/zsh" };
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped();
        const launcher = path.join(home, ".vetra-code", "bin", "vetra");
        env.PATH = [path.dirname(launcher), path.join(home, ".local", "bin")].join(":");

        const command = yield* commandIn({ home, env });
        const installed = yield* command.install;

        expect(yield* fs.exists(launcher)).toBe(true);
        expect(installed).toMatchObject({
          onPath: true,
          installedPath: path.join(home, ".local", "bin", "vetra"),
        });
        expect(installed.shadowedBy).toBeUndefined();
        expect(yield* command.state).toEqual(installed);

        const removed = yield* command.uninstall;
        expect(removed.installedPath).toBeNull();
        expect(removed.onPath).toBe(true);
        expect(yield* command.state).toEqual(removed);
        expect(yield* fs.exists(installed.installedPath!)).toBe(false);
        expect(yield* fs.exists(launcher)).toBe(true);
      }).pipe(Effect.scoped),
  );

  it.effect("leaves the Windows PATH alone when it cannot be read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const userPath = "C:\\Users\\Me\\npm;%USERPROFILE%\\tools";
      const { registry, spawner } = fakePowerShell(userPath);
      const command = yield* commandIn({ home, platform: "win32" }, spawner);

      registry.failReads = true;
      const error = yield* Effect.flip(command.install);
      expect(error.message).toContain("left unchanged");
      expect(registry).toMatchObject({ path: userPath, writes: 0 });

      registry.failReads = false;
      const launcherDir = DesktopCliShim.launcherPath(
        environmentFor(yield* Path.Path, {
          home,
          baseDir: `${home}/.vetra-code`,
          platform: "win32",
        }),
      ).replace(/[\\/]vetra\.cmd$/, "");
      yield* command.install;
      expect(registry.path).toBe(`${userPath};${launcherDir}`);
      yield* command.uninstall;
      expect(registry.path).toBe(userPath);

      // A `;` in the folder would split it into two PATH entries, so nothing is written.
      const split = fakePowerShell(userPath);
      const semicolon = yield* commandIn(
        { home, baseDir: `${home}\\T3;Home`, platform: "win32" },
        split.spawner,
      );
      expect((yield* Effect.flip(semicolon.install)).message).toContain('has a ";"');
      expect(split.registry).toMatchObject({ path: userPath, writes: 0 });

      // An inherited VETRA_SET=1 never turns a read into a write of the whole PATH.
      const inherited = fakePowerShell(userPath, { VETRA_SET: "1", VETRA_PATH: "C:\\other" });
      const reader = yield* commandIn({ home, platform: "win32" }, inherited.spawner);
      yield* reader.install;
      expect(inherited.registry).toMatchObject({ path: `${userPath};${launcherDir}`, writes: 1 });
    }).pipe(Effect.scoped),
  );

  it.effect("does not claim or remove a Windows PATH entry the user added", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const launcherDir = path.dirname(
        DesktopCliShim.launcherPath(
          environmentFor(path, {
            home,
            baseDir: path.join(home, ".vetra-code"),
            platform: "win32",
          }),
        ),
      );
      const userPath = `C:\\Tools;${launcherDir}`;
      const { registry, spawner } = fakePowerShell(userPath);
      const command = yield* commandIn({ home, platform: "win32" }, spawner);

      expect((yield* command.state).installedPath).toBeNull();
      yield* command.uninstall;
      expect(registry.path).toBe(userPath);

      // A fresh install beside a standalone vetra.cmd (from `vetra install`), even off PATH, leaves
      // PATH alone.
      const besideHome = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(path.join(besideHome, ".local", "bin"), { recursive: true });
      yield* fs.writeFileString(
        path.join(besideHome, ".local", "bin", "vetra.cmd"),
        "@echo off\r\n",
      );
      const beside = fakePowerShell("C:\\Tools");
      yield* (yield* commandIn({ home: besideHome, platform: "win32" }, beside.spawner))
        .installOnFirstLaunch;
      expect(beside.registry).toMatchObject({ path: "C:\\Tools", writes: 0 });
    }).pipe(Effect.scoped),
  );
});
