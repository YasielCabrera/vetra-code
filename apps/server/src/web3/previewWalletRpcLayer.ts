import { PreviewWalletRpcGroup, WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";

import type * as ServerPreviewWallet from "./ServerPreviewWallet.ts";

/**
 * The preview wallet RPCs over one socket session: a person watching and
 * approving any tab's requests. A slow socket gets the latest state, not every
 * state in between.
 */
export const previewWalletRpcLayer = (wallet: ServerPreviewWallet.ServerPreviewWallet["Service"]) =>
  PreviewWalletRpcGroup.toLayer(
    PreviewWalletRpcGroup.of({
      [WS_METHODS.previewWalletSubscribe]: () =>
        wallet.changes.pipe(Stream.buffer({ capacity: 1, strategy: "sliding" })),
      [WS_METHODS.previewWalletConfigure]: (input) => wallet.configure(input),
      [WS_METHODS.previewWalletApprove]: (input) => wallet.approve(input.requestId),
      [WS_METHODS.previewWalletReject]: (input) => wallet.reject(input.requestId, input.code),
    }),
  );
