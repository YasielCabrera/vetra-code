import packageJson from "../../package.json" with { type: "json" };
import { BUILD_MIGRATION_HEAD, recordedMigrations } from "../persistence/databaseMigrationHead.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "./serviceProtocol.ts";

export type ServicePreflightResult =
  | {
      readonly status: "ready";
      readonly version: string;
      readonly launcherProtocol: typeof SERVICE_LAUNCHER_PROTOCOL;
    }
  | {
      readonly status: "blocked";
      readonly version: string;
      readonly reason: string;
    };

export function runServicePreflight(input: {
  readonly databasePath: string;
  readonly launcherProtocol: number;
  readonly version?: string;
}): ServicePreflightResult {
  const version = input.version ?? packageJson.version;
  if (input.launcherProtocol !== SERVICE_LAUNCHER_PROTOCOL) {
    return {
      status: "blocked",
      version,
      reason: [
        `The installed service launcher speaks protocol ${input.launcherProtocol}, but Vetra Code ${version} requires protocol ${SERVICE_LAUNCHER_PROTOCOL}.`,
        `On the server machine, update and rebuild the Vetra Code source checkout matching version ${version}.`,
        `Check that \`vetra --version\` prints ${version} and that \`which -a vetra\` lists the rebuilt CLI first, then run \`vetra service install\` with that CLI.`,
        "Updating the desktop app does not update this CLI, and `vetra service update` only repairs the service with whichever CLI runs it.",
      ].join(" "),
    };
  }

  const newer = newerRecordedMigrations(input.databasePath);
  if (newer === null) {
    return {
      status: "blocked",
      version,
      reason: `Could not read this database to confirm t3@${version} supports it.`,
    };
  }
  if (newer.length > 0) {
    return {
      status: "blocked",
      version,
      reason: `This database has migrations that t3@${version} does not know: ${newer.join(", ")}. A newer build wrote them, and running t3@${version} on this database is not safe. Stay on the newer release, or wait for a release that includes these migrations.`,
    };
  }

  return { status: "ready", version, launcherProtocol: SERVICE_LAUNCHER_PROTOCOL };
}

/** Migrations a newer build recorded, or null when the database exists but cannot be read.
 * Startup already handles renamed ids this build knows. */
function newerRecordedMigrations(databasePath: string): ReadonlyArray<string> | null {
  const recorded = recordedMigrations(databasePath);
  return recorded === null
    ? null
    : recorded.filter(({ id }) => id > BUILD_MIGRATION_HEAD).map(({ id, name }) => `${id}_${name}`);
}

export function decodeServicePreflightResult(value: unknown): ServicePreflightResult | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.status === "ready" &&
    record.launcherProtocol === SERVICE_LAUNCHER_PROTOCOL &&
    typeof record.version === "string"
  ) {
    return {
      status: "ready",
      version: record.version,
      launcherProtocol: SERVICE_LAUNCHER_PROTOCOL,
    };
  }
  if (
    record.status === "blocked" &&
    typeof record.version === "string" &&
    typeof record.reason === "string"
  ) {
    return { status: "blocked", version: record.version, reason: record.reason };
  }
  return undefined;
}
