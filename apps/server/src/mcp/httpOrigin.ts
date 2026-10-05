import * as Result from "effect/Result";
import type * as HttpServer from "effect/unstable/http/HttpServer";
import * as NetAddress from "effect/unstable/net/NetAddress";

export function providerHttpOrigin(address: HttpServer.HttpServer["Service"]["address"]) {
  if (!NetAddress.isInetAddress(address)) {
    return Result.fail(
      new NetAddress.NetAddressError({
        input: address,
        message: "Agent HTTP URLs require a TCP listener; Unix sockets are unsupported.",
      }),
    );
  }
  return Result.map(NetAddress.toUrl(address), (url) => {
    if (NetAddress.isUnspecified(address.address)) url.hostname = "127.0.0.1";
    return url.origin;
  });
}
