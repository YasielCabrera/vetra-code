/**
 * The preview wallet's chip and approval sheet.
 *
 * Lives in the preview chrome next to the "Agent controlling browser" badge.
 * When requests are parked, the chip carries a count and opening it shows what
 * each request would do, decoded, with approve and reject-with-code actions —
 * rejection has to be a first-class action so dapp rejection branches are
 * testable by hand as well as through `preview_wallet_reject`.
 */
import {
  WEB3_REJECT_CODES,
  type Web3PendingRequest,
  type Web3RejectCode,
} from "@vetra-code/web3/schema";
import { WalletIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { formatWalletChip } from "../settings/web3Settings.logic";
import { useWalletStatus } from "../settings/useWalletStatus";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { previewBridge } from "./previewBridge";

const REJECT_CODE_LABELS: Readonly<Record<Web3RejectCode, string>> = {
  4001: "4001 · User rejected",
  4100: "4100 · Unauthorized",
  4900: "4900 · Disconnected",
  4902: "4902 · Unknown chain",
};

function PendingRequestCard({
  request,
  onResolved,
}: {
  readonly request: Web3PendingRequest;
  readonly onResolved: () => void;
}) {
  const [rejectCode, setRejectCode] = useState<Web3RejectCode>(4001);
  const [busy, setBusy] = useState(false);
  const bridge = previewBridge?.wallet ?? null;

  const resolve = useCallback(
    async (action: "approve" | "reject") => {
      if (!bridge || busy) return;
      setBusy(true);
      try {
        if (action === "approve") {
          await bridge.approve("", { requestId: request.requestId });
        } else {
          await bridge.reject("", { requestId: request.requestId, code: rejectCode });
        }
        onResolved();
      } finally {
        setBusy(false);
      }
    },
    [bridge, busy, onResolved, rejectCode, request.requestId],
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{request.method}</span>
        <span className="truncate text-[11px] text-muted-foreground">{request.origin}</span>
      </div>
      <p className="text-xs break-words">{request.summary}</p>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={busy}
          onClick={() => void resolve("approve")}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={busy}
          onClick={() => void resolve("reject")}
        >
          Reject
        </Button>
        <Select
          value={String(rejectCode)}
          onValueChange={(value) => setRejectCode(Number(value) as Web3RejectCode)}
        >
          <SelectTrigger className="h-7 w-40 text-xs" aria-label="Rejection code">
            <SelectValue>{REJECT_CODE_LABELS[rejectCode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {WEB3_REJECT_CODES.map((code) => (
              <SelectItem hideIndicator key={code} value={String(code)}>
                {REJECT_CODE_LABELS[code]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
    </div>
  );
}

export function PreviewWalletChip() {
  const { status, refresh } = useWalletStatus();
  const label = formatWalletChip(status);
  if (!status?.enabled || label === null) return null;

  const pendingCount = status.pendingRequests.length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            aria-label={
              pendingCount > 0
                ? `Preview wallet, ${pendingCount} request${pendingCount === 1 ? "" : "s"} awaiting approval`
                : "Preview wallet"
            }
          >
            <WalletIcon className="size-3.5" aria-hidden />
            <span className="max-w-40 truncate">{label}</span>
            {pendingCount > 0 ? (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
                {pendingCount}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverPopup align="end" className="w-96">
        <div className="flex flex-col gap-2 p-1">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium">Preview wallet</span>
            <span className="text-[11px] text-muted-foreground">
              {status.chain === null
                ? "No network resolved."
                : status.rpcReachable
                  ? `${status.chain.name} · ${status.chain.chainId}`
                  : `${status.chain.name} · ${status.chain.chainId} · endpoint unreachable`}
            </span>
          </div>

          {pendingCount === 0 ? (
            <p className="py-2 text-[11px] text-muted-foreground">
              Nothing waiting. Requests appear here when approval is needed.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {status.pendingRequests.map((request) => (
                <PendingRequestCard
                  key={request.requestId}
                  request={request}
                  onResolved={() => void refresh()}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
