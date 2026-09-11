import * as Context from "effect/Context";

export class WebCrypto extends Context.Service<WebCrypto, { readonly subtle: SubtleCrypto }>()(
  "@vetra-code/relay/WebCrypto",
) {}
