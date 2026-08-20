import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { SourceControlProviderKind } from "@vetra-code/contracts";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitHubIssueCli from "./GitHubIssueCli.ts";
import * as GitHubIssueProvider from "./GitHubIssueProvider.ts";
import type { IssueProviderApi } from "./IssueProvider.ts";

export class IssueProviderRegistry extends Context.Service<
  IssueProviderRegistry,
  {
    readonly get: (kind: SourceControlProviderKind) => IssueProviderApi | null;
    readonly kinds: ReadonlyArray<SourceControlProviderKind>;
  }
>()("@vetra-code/server/issue/IssueProviderRegistry") {}

export function fromProviders(
  providers: ReadonlyArray<IssueProviderApi>,
): IssueProviderRegistry["Service"] {
  const byKind = new Map(providers.map((provider) => [provider.kind, provider]));
  return {
    get: (kind) => byKind.get(kind) ?? null,
    kinds: providers.map((provider) => provider.kind),
  };
}

export const make = Effect.map(GitHubIssueProvider.make, (github) => fromProviders([github]));

export const layer = Layer.effect(IssueProviderRegistry, make).pipe(
  Layer.provide(GitHubIssueCli.layer.pipe(Layer.provide(GitHubCli.layer))),
);
