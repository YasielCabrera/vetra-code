import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { compareSemverVersions } from "./semver.ts";

/**
 * Naming shared by the release workflow, the runtime installers, and
 * install scripts for the per-platform CLI archives attached to GitHub
 * Releases. Every consumer derives the same file names from a version and a
 * platform key, so a rename here is a release-breaking change.
 */

/**
 * Archive downloads and the release index use a reserved `.invalid` host until
 * Vetra publishes CLI archives. `VETRA_RELEASE_BASE_URL` overrides downloads.
 */
const CLI_RELEASE_ORIGIN = "https://releases.vetra.invalid";
export const CLI_RELEASES_PAGE_URL = `${CLI_RELEASE_ORIGIN}/releases`;
export const CLI_RELEASE_CHECKSUMS_FILE = "SHA256SUMS";
export const CLI_RELEASE_BASE_URL_ENV = "VETRA_RELEASE_BASE_URL";

// Keep archive keys aligned with the Linux matrix, Windows ARM64 build, and cli_archive rows in release.yml.
// Node single-executables do not support darwin-x64 and segfault at startup.
const CLI_ARCHIVE_PLATFORM_KEYS = [
  "darwin-arm64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
] as const;
export type CliArchivePlatformKey = (typeof CLI_ARCHIVE_PLATFORM_KEYS)[number];

export function cliArchivePlatformKey(
  platform: NodeJS.Platform,
  arch: string,
): CliArchivePlatformKey | undefined {
  const key = `${platform}-${arch}`;
  return CLI_ARCHIVE_PLATFORM_KEYS.find((candidate) => candidate === key);
}

/** Use System32 bsdtar on Windows; Git-for-Windows GNU tar cannot open zip archives. */
export function cliArchiveTarCommand(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (platform !== "win32") return "tar";
  const systemRoot = env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows";
  return `${systemRoot}\\System32\\tar.exe`;
}

export function cliArchiveFileName(version: string, platformKey: CliArchivePlatformKey): string {
  return `vetra-${version}-${platformKey}.${platformKey.startsWith("win32") ? "zip" : "tar.gz"}`;
}

const CLI_RELEASE_DEFAULT_BASE_URL = `${CLI_RELEASE_ORIGIN}/releases/download`;

export function cliReleaseDownloadBaseUrl(
  version: string,
  baseUrl: string | undefined = CLI_RELEASE_DEFAULT_BASE_URL,
): string {
  return `${(baseUrl?.trim() || CLI_RELEASE_DEFAULT_BASE_URL).replace(/\/+$/, "")}/v${version}`;
}

export function parseChecksums(text: string): ReadonlyMap<string, string> {
  const checksums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      checksums.set(match[2], match[1].toLowerCase());
    }
  }
  return checksums;
}

export type CliReleaseChannel = "stable" | "nightly" | "preview";
export const CLI_RELEASE_CHANNELS: ReadonlyArray<CliReleaseChannel> = [
  "stable",
  "nightly",
  "preview",
];

export function cliReleaseChannelOf(version: string): CliReleaseChannel {
  const channel = /^[^-+]+-(nightly|preview)\.\d{8}\.\d+$/.exec(version)?.[1];
  return channel === "nightly" || channel === "preview" ? channel : "stable";
}

/** Whether updating between these versions crosses Stable and Nightly. Preview builds cross nothing.
 * Hosts refuse a crossing outside a track switch, which checks the database first. */
export function crossesReleaseTrack(fromVersion: string, toVersion: string): boolean {
  const from = cliReleaseChannelOf(fromVersion);
  const to = cliReleaseChannelOf(toVersion);
  return from !== to && from !== "preview" && to !== "preview";
}

/** The desktop update track a build belongs to. Preview builds have no feed and read as Stable. */
export function desktopUpdateChannelOf(version: string): "latest" | "nightly" {
  return cliReleaseChannelOf(version) === "nightly" ? "nightly" : "latest";
}

/** Whether a track switch may install `found` after its database check cleared `checked`: any build
 * on the switch's track at least as new, since later releases only add migrations. */
export function acceptsTrackSwitchRelease(
  found: string,
  channel: "latest" | "nightly",
  checked: string,
): boolean {
  return (
    cliReleaseChannelOf(found) === (channel === "nightly" ? "nightly" : "stable") &&
    compareSemverVersions(found, checked) >= 0
  );
}

/** Page until the channel matches; nightlies can push preview/stable releases past the first page. */
export function cliReleaseIndexPageUrl(page: number): string {
  return `${CLI_RELEASE_ORIGIN}/releases?per_page=100&page=${page}`;
}

/** Draft assets are not downloadable. */
export function newestCliReleaseVersion(
  releases: ReadonlyArray<{
    readonly tag_name: string;
    readonly draft?: boolean | undefined;
  }>,
  channel: CliReleaseChannel,
): string | undefined {
  for (const release of releases) {
    if (release.draft) continue;
    const version = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(release.tag_name)?.[1];
    if (version === undefined) continue;
    if (cliReleaseChannelOf(version) === channel) return version;
  }
  return undefined;
}

const NpmReleaseMigrationManifest = Schema.Struct({
  t3code: Schema.Struct({ databaseMigration: Schema.Int }),
});
const decodeNpmReleaseMigrationManifest = Schema.decodeUnknownOption(NpmReleaseMigrationManifest);

/** Highest database migration a release's server knows, from its npm `vetra` manifest. */
export function npmReleaseDatabaseMigration(manifest: unknown): number | undefined {
  return Option.getOrUndefined(decodeNpmReleaseMigrationManifest(manifest))?.t3code
    .databaseMigration;
}
