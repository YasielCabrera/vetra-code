import * as Base64Url from "effect/encoding/Base64Url";
import { CheckpointRef, type ThreadId } from "@t3tools/contracts";
import { PRODUCT_CHECKPOINT_REFS_PREFIX } from "@t3tools/shared/productIdentity";

const CHECKPOINT_REFS_PREFIX = PRODUCT_CHECKPOINT_REFS_PREFIX;

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.make(
    `${CHECKPOINT_REFS_PREFIX}/${Base64Url.encode(threadId)}/turn/${turnCount}`,
  );
}
