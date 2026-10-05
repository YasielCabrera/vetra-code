import { describe, expect, it } from "vite-plus/test";
import * as Result from "effect/Result";
import * as NetAddress from "effect/unstable/net/NetAddress";

import { providerHttpOrigin } from "./httpOrigin.ts";

describe("provider HTTP origin", () => {
  it.each([
    ["100.64.0.40", 43123, "http://100.64.0.40:43123"],
    ["127.0.0.1", 51987, "http://127.0.0.1:51987"],
    ["0.0.0.0", 43123, "http://127.0.0.1:43123"],
    ["::", 43123, "http://127.0.0.1:43123"],
    ["::1", 43123, "http://[::1]:43123"],
  ])("uses the bound address %s and port %i", (host, port, expected) => {
    expect(
      Result.getOrThrow(providerHttpOrigin(NetAddress.inetAddressFromIpStringUnsafe(host, port))),
    ).toBe(expected);
  });

  it("rejects Unix sockets and scoped IPv6 with the address error", () => {
    const unix = providerHttpOrigin(NetAddress.unixPathAddress("/tmp/vetra-test.sock"));
    const scoped = providerHttpOrigin(
      Result.getOrThrow(
        NetAddress.inetAddressV6(Result.getOrThrow(NetAddress.ipv6FromString("fe80::1")), 43123, {
          scopeId: 3,
        }),
      ),
    );
    expect(Result.isFailure(unix)).toBe(true);
    expect(Result.isFailure(scoped)).toBe(true);
    if (Result.isFailure(unix)) expect(unix.failure.message).toContain("Unix sockets");
    if (Result.isFailure(scoped)) expect(scoped.failure.message).toContain("scoped IPv6");
  });
});
