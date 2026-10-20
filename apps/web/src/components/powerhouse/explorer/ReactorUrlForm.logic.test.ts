import { describe, expect, it } from "vite-plus/test";

import {
  changeReactorAuthentication,
  reactorAuthenticationDraft,
  reactorAuthenticationHeaders,
} from "./ReactorUrlForm.logic";

describe("reactor authentication controls", () => {
  it("builds the authorization header from a token without JSON", () => {
    expect(reactorAuthenticationHeaders({ kind: "bearer", token: "  renown-token  " })).toEqual({
      authorization: "Bearer renown-token",
    });
    expect(reactorAuthenticationHeaders({ kind: "bearer", token: "Bearer renown-token" })).toEqual({
      authorization: "Bearer renown-token",
    });
  });

  it.each(["", "   ", "Bearer", "Bearer ", "token\r\nInjected: yes"])(
    "rejects an invalid token: %s",
    (token) => {
      expect(reactorAuthenticationHeaders({ kind: "bearer", token })).toBeNull();
    },
  );

  it("opens existing bearer credentials in the token field", () => {
    expect(reactorAuthenticationDraft({ Authorization: "Bearer renown-token" })).toEqual({
      kind: "bearer",
      token: "renown-token",
    });
    expect(reactorAuthenticationDraft({ authorization: "bearer renown-token" })).toEqual({
      kind: "bearer",
      token: "renown-token",
    });
  });

  it("preserves custom authentication headers when reopening the form", () => {
    const headers = { Authorization: "Bearer token", "X-API-Key": "api-key" };
    const draft = reactorAuthenticationDraft(headers);
    expect(draft.kind).toBe("headers");
    expect(reactorAuthenticationHeaders(draft)).toEqual({
      authorization: "Bearer token",
      "x-api-key": "api-key",
    });
    expect(reactorAuthenticationDraft({ Authorization: "Basic credentials" }).kind).toBe("headers");
  });

  it("converts a token to editable JSON and back", () => {
    const custom = changeReactorAuthentication(
      { kind: "bearer", token: "renown-token" },
      "headers",
    );
    expect(custom).toEqual({
      kind: "headers",
      json: JSON.stringify({ authorization: "Bearer renown-token" }, null, 2),
    });
    expect(changeReactorAuthentication(custom, "bearer")).toEqual({
      kind: "bearer",
      token: "renown-token",
    });
  });

  it("removes authentication when None is selected", () => {
    const draft = changeReactorAuthentication({ kind: "bearer", token: "secret" }, "none");
    expect(reactorAuthenticationHeaders(draft)).toBeUndefined();
    expect(reactorAuthenticationDraft(undefined)).toEqual({ kind: "none" });
    expect(reactorAuthenticationDraft({})).toEqual({ kind: "none" });
  });

  it("validates raw custom headers and handles switching from invalid JSON", () => {
    expect(reactorAuthenticationHeaders({ kind: "headers", json: '{"X-API-Key":"key"}' })).toEqual({
      "x-api-key": "key",
    });
    const invalid = { kind: "headers", json: "{broken" } as const;
    expect(reactorAuthenticationHeaders(invalid)).toBeNull();
    expect(changeReactorAuthentication(invalid, "bearer")).toEqual({ kind: "bearer", token: "" });
  });
});
