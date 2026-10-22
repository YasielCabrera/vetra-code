// @effect-diagnostics nodeBuiltinImport:off - Runs before the Effect runtime starts, on raw file descriptors.
import * as NodeFS from "node:fs";
import * as NodeTty from "node:tty";

import * as HostProcess from "@t3tools/shared/HostProcess";

/**
 * Whether this process is the desktop app's `vetra.cmd` running the CLI in a
 * terminal with no stdin. The launcher runs the app's executable with
 * `ELECTRON_RUN_AS_NODE`, and Electron's Windows executable is a GUI program:
 * on start it points stdout and stderr at the parent's console but leaves
 * stdin unset, so prompts see no terminal and children such as the agent
 * `vetra triage` starts inherit nothing to read from. Input the user piped or
 * redirected is a valid descriptor and is left alone, as is any run whose
 * output is not a console (the desktop backend, scripts).
 */
function needsConsoleStdin(input: {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly stdinOpen: boolean;
  readonly stdoutIsConsole: boolean;
}): boolean {
  return (
    input.platform === "win32" &&
    // Set only by the launcher (DesktopCliShim), never for the desktop backend.
    input.env.VETRA_DESKTOP_CLI_LAUNCHER === "1" &&
    !input.stdinOpen &&
    input.stdoutIsConsole
  );
}

const isOpen = (fd: number) => {
  try {
    NodeFS.fstatSync(fd);
    return true;
  } catch {
    return false;
  }
};

/**
 * Reopens the console's input as `process.stdin` when {@link needsConsoleStdin}
 * holds, and returns its descriptor so interactive children can be given the
 * same console. Returns undefined, changing nothing, everywhere else.
 * Call before anything reads `process.stdin`.
 */
export function attachConsoleStdin(): number | undefined {
  const needed = needsConsoleStdin({
    platform: HostProcess.Platform.defaultValue(),
    env: process.env,
    stdinOpen: isOpen(0),
    stdoutIsConsole: NodeTty.isatty(1),
  });
  // The marker describes this process's own start; a server started here
  // must not pass it on to the shells and `vetra` runs it spawns.
  delete process.env.VETRA_DESKTOP_CLI_LAUNCHER;
  if (!needed) return undefined;
  let fd: number;
  try {
    fd = NodeFS.openSync("\\\\.\\CONIN$", "r+");
  } catch {
    return undefined;
  }
  if (!NodeTty.isatty(fd)) {
    NodeFS.closeSync(fd);
    return undefined;
  }
  const stdin = new NodeTty.ReadStream(fd);
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true, enumerable: true });
  return fd;
}
