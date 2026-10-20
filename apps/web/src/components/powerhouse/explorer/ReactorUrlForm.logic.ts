import type { PowerhouseGraphqlHeaders } from "@t3tools/contracts";

import { parseReactorHeaders } from "../PowerhousePanel.logic";

export type ReactorAuthenticationDraft =
  | { readonly kind: "none" }
  | { readonly kind: "bearer"; readonly token: string }
  | { readonly kind: "headers"; readonly json: string };

function bearerToken(headers: PowerhouseGraphqlHeaders): string | null {
  const authorization = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "authorization",
  )?.[1];
  return authorization?.trim().match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

export function reactorAuthenticationDraft(
  headers: PowerhouseGraphqlHeaders | undefined,
): ReactorAuthenticationDraft {
  if (headers === undefined || Object.keys(headers).length === 0) return { kind: "none" };
  const token = bearerToken(headers);
  return token !== null && Object.keys(headers).length === 1
    ? { kind: "bearer", token }
    : { kind: "headers", json: JSON.stringify(headers, null, 2) };
}

export function reactorAuthenticationHeaders(
  draft: ReactorAuthenticationDraft,
): PowerhouseGraphqlHeaders | null | undefined {
  switch (draft.kind) {
    case "none":
      return undefined;
    case "bearer": {
      const token = draft.token
        .trim()
        .replace(/^Bearer(?:\s+|$)/i, "")
        .trim();
      return token.length === 0
        ? null
        : parseReactorHeaders(JSON.stringify({ authorization: `Bearer ${token}` }));
    }
    case "headers":
      return parseReactorHeaders(draft.json);
  }
}

export function changeReactorAuthentication(
  draft: ReactorAuthenticationDraft,
  kind: ReactorAuthenticationDraft["kind"],
): ReactorAuthenticationDraft {
  if (draft.kind === kind) return draft;
  const headers = reactorAuthenticationHeaders(draft);
  switch (kind) {
    case "none":
      return { kind };
    case "bearer":
      return { kind, token: headers ? (bearerToken(headers) ?? "") : "" };
    case "headers":
      return { kind, json: headers ? JSON.stringify(headers, null, 2) : "" };
  }
}
