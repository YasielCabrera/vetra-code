import * as Option from "effect/Option";
import { PRODUCT_HOME_DIRECTORY_NAME } from "@vetra-code/shared/productIdentity";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(vetraHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(vetraHome)) {
    return Option.none();
  }
  const trimmed = vetraHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly vetraHome: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.vetraHome), () =>
    input.joinPath(input.homeDirectory, PRODUCT_HOME_DIRECTORY_NAME),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly vetraHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.vetraHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
