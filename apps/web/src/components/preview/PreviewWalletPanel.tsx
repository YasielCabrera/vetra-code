/**
 * The preview wallet's chip and approval sheet.
 *
 * Lives in the preview chrome next to the "Agent controlling browser" badge.
 * Opening it shows the active account the way an extension wallet does, and
 * when a request is parked, a decoded summary with approve and reject
 * actions. Reject always tells the page the user declined (`4001`); other
 * EIP-1193 codes stay on `preview_wallet_reject` for agent-driven tests.
 */
import type { PreviewAutomationWalletConfigureInput } from "@vetra-code/contracts";
import { enabledBuiltInNetworks, findCustomNetwork } from "@vetra-code/web3/networks";
import {
  DEFAULT_WEB3_REJECT_CODE,
  type Web3Account,
  type Web3PendingRequest,
} from "@vetra-code/web3/schema";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WalletIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { acquireHostedBrowserPointerLock } from "~/browser/hostedBrowserPointerLock";
import { cn } from "~/lib/utils";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { AccountIdenticon } from "../settings/AccountIdenticon";
import { AccountLabelEditor } from "../settings/AccountLabelEditor";
import { getWalletStatus, useWalletStatus } from "../settings/useWalletStatus";
import {
  originHostname,
  pendingRequestTitle,
  removeAccountConfirmationMessage,
  shortenAddress,
} from "../settings/web3Settings.logic";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { NetworkIcon } from "../web3/NetworkIcon";
import { previewBridge } from "./previewBridge";

function CopyAddressButton({ address }: { readonly address: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="xs"
      className="h-6 gap-1 px-1.5 font-mono text-[11px] text-muted-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => setCopied(true));
      }}
      aria-label={copied ? "Address copied" : `Copy ${address}`}
    >
      {shortenAddress(address)}
      {copied ? (
        <CheckIcon className="size-3" aria-hidden />
      ) : (
        <CopyIcon className="size-3" aria-hidden />
      )}
    </Button>
  );
}

function SelectedAccountAvatar({
  address,
  size,
  iconClassName,
}: {
  readonly address: string | null;
  readonly size: number;
  readonly iconClassName: string;
}) {
  if (address === null) {
    return (
      <div
        className="flex items-center justify-center rounded-full bg-accent"
        style={{ width: size, height: size }}
      >
        <WalletIcon className={iconClassName} aria-hidden />
      </div>
    );
  }
  return <AccountIdenticon address={address} size={size} />;
}

function AccountMenu({
  accounts,
  selectedAddress,
  disabled,
  onSelect,
}: {
  readonly accounts: readonly Web3Account[];
  readonly selectedAddress: string | null;
  readonly disabled: boolean;
  readonly onSelect: (address: string) => void;
}) {
  const selected = accounts.find((account) => account.address === selectedAddress);

  return (
    <Select
      value={selectedAddress ?? "no-account"}
      onValueChange={(value) => {
        if (typeof value !== "string" || value === "no-account") return;
        onSelect(value);
      }}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className="h-7 w-auto min-w-0 max-w-[14rem] justify-start gap-1 px-1.5 font-medium text-foreground"
        aria-label="Switch preview wallet account"
        disabled={disabled}
        icon={<ChevronDownIcon className="size-3.5 opacity-70" />}
      >
        {selected === undefined ? (
          <SelectValue>No account</SelectValue>
        ) : (
          <span className="truncate">{selected.label}</span>
        )}
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false} matchTriggerWidth={false}>
        {accounts.length === 0 ? (
          <SelectItem hideIndicator disabled value="no-account">
            No account
          </SelectItem>
        ) : (
          accounts.map((account) => (
            <SelectItem hideIndicator key={account.address} value={account.address}>
              <span className="flex min-w-0 items-center gap-2">
                <AccountIdenticon address={account.address} size={20} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{account.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {shortenAddress(account.address)}
                  </span>
                </span>
              </span>
            </SelectItem>
          ))
        )}
      </SelectPopup>
    </Select>
  );
}

function AccountOverflowMenu({
  disabled,
  onRename,
  onRemove,
}: {
  readonly disabled: boolean;
  readonly onRename: () => void;
  readonly onRemove: () => void;
}) {
  return (
    <Menu modal={false}>
      <MenuTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-6 shrink-0"
            aria-label="Account options"
            disabled={disabled}
          />
        }
      >
        <MoreHorizontalIcon aria-hidden className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-44">
        <MenuItem onClick={onRename}>
          <PencilIcon aria-hidden />
          Rename account
        </MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive" onClick={onRemove}>
          <Trash2Icon aria-hidden />
          Remove account
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function ActiveAccountRow({
  accounts,
  activeAccount,
  selectedAddress,
  disabled,
  renaming,
  align,
  onSelect,
  onStartRename,
  onFinishRename,
  onCommitLabel,
  onRemove,
}: {
  readonly accounts: readonly Web3Account[];
  readonly activeAccount: Web3Account | undefined;
  readonly selectedAddress: string | null;
  readonly disabled: boolean;
  readonly renaming: boolean;
  readonly align: "center" | "start";
  readonly onSelect: (address: string) => void;
  readonly onStartRename: () => void;
  readonly onFinishRename: () => void;
  readonly onCommitLabel: (address: string, nextLabel: string) => void;
  readonly onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-0.5",
        align === "center" ? "justify-center" : "min-w-0",
      )}
    >
      {renaming && activeAccount !== undefined ? (
        <AccountLabelEditor
          key={activeAccount.address}
          address={activeAccount.address}
          label={activeAccount.label}
          disabled={disabled}
          defaultEditing
          className={cn("font-medium", align === "center" && "text-center")}
          onCommit={onCommitLabel}
          onEditingEnd={onFinishRename}
        />
      ) : (
        <AccountMenu
          accounts={accounts}
          selectedAddress={selectedAddress}
          disabled={disabled}
          onSelect={onSelect}
        />
      )}
      {activeAccount === undefined ? null : (
        <AccountOverflowMenu disabled={disabled} onRename={onStartRename} onRemove={onRemove} />
      )}
    </div>
  );
}

function PendingRequestCard({
  request,
  onResolved,
}: {
  readonly request: Web3PendingRequest;
  readonly onResolved: (completed: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const bridge = previewBridge?.wallet ?? null;

  const resolve = useCallback(
    async (action: "approve" | "reject") => {
      if (!bridge || busy) return;
      setBusy(true);
      try {
        if (action === "approve") {
          const resolution = await bridge.approve("", { requestId: request.requestId });
          if (resolution.failure !== null) {
            toastManager.add({
              type: "error",
              title: "Could not approve request",
              description: resolution.failure,
            });
          }
        } else {
          await bridge.reject("", {
            requestId: request.requestId,
            code: DEFAULT_WEB3_REJECT_CODE,
          });
        }
        onResolved(true);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: action === "approve" ? "Could not approve request" : "Could not reject request",
          description:
            error instanceof Error ? error.message : "The preview wallet did not respond.",
        });
        onResolved(false);
      } finally {
        setBusy(false);
      }
    },
    [bridge, busy, onResolved, request.requestId],
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-accent/30 p-3">
      <div className="flex flex-col gap-1">
        <span className="truncate text-[11px] text-muted-foreground">
          {originHostname(request.origin)}
        </span>
        <span className="text-sm font-medium">{pendingRequestTitle(request.method)}</span>
        <p className="text-xs leading-relaxed break-words text-muted-foreground">
          {request.summary}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={busy}
          onClick={() => void resolve("reject")}
        >
          Reject
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={busy}
          onClick={() => void resolve("approve")}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}

export function PreviewWalletChip() {
  const { status, refresh } = useWalletStatus();
  const walletSettings = usePrimarySettings((settings) => settings.web3Wallet);
  const updateSettings = useUpdatePrimarySettings();
  const bridge = previewBridge?.wallet ?? null;
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const previousPendingKey = useRef("");
  const pointerInsidePopup = useRef(false);
  const pendingKey = status?.pendingRequests.map((request) => request.requestId).join("|") ?? "";

  // A wallet extension opens its approval surface when a page asks to sign.
  // The preview chip should do the same instead of expecting the user to notice
  // a badge and open it while the dapp is blocked on a Promise.
  useEffect(() => {
    if (pendingKey.length > 0 && pendingKey !== previousPendingKey.current) setOpen(true);
    previousPendingKey.current = pendingKey;
  }, [pendingKey]);

  // Electron's preview webview is a native guest. Clicks on this popover also
  // hit the page underneath unless the webview ignores pointer events for the
  // duration of the overlay — otherwise the dapp treats Approve as an outside
  // click and dismisses its own modal.
  useLayoutEffect(() => {
    if (!open) {
      pointerInsidePopup.current = false;
      return;
    }
    return acquireHostedBrowserPointerLock();
  }, [open]);

  // Clicking the guest still moves focus out of the renderer without producing
  // the outside press Base UI uses to dismiss a popover. Ignore blur while the
  // pointer is on the popover itself; that is the overlapping-webview case.
  useEffect(() => {
    if (!open) setRenaming(false);
  }, [open]);

  // Clicking the guest still moves focus out of the renderer without producing
  // the outside press Base UI uses to dismiss a popover. Ignore blur while the
  // pointer is on the popover itself; that is the overlapping-webview case.
  useEffect(() => {
    if (!open) return;
    const close = () => {
      if (pointerInsidePopup.current) return;
      setOpen(false);
    };
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [open]);

  const configure = useCallback(
    async (action: string, input: PreviewAutomationWalletConfigureInput, failedTitle: string) => {
      if (!bridge || busyAction !== null) return;
      setBusyAction(action);
      try {
        await bridge.configure("", input);
        await refresh();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: failedTitle,
          description:
            error instanceof Error ? error.message : "The preview wallet did not respond.",
        });
      } finally {
        setBusyAction(null);
      }
    },
    [bridge, busyAction, refresh],
  );

  const confirmRemoveAccount = useCallback(
    async (account: Web3Account) => {
      setOpen(false);
      const confirmed = await ensureLocalApi().dialogs.confirm(
        removeAccountConfirmationMessage(account),
        { variant: "destructive" },
      );
      if (!confirmed) return;
      await configure(
        `remove:${account.address}`,
        { removeAccount: account.address },
        "Could not remove the account",
      );
    },
    [configure],
  );

  const handleRequestResolved = useCallback(
    (completed: boolean) => {
      if (completed) setOpen(false);
      void refresh().then(() => {
        if ((getWalletStatus()?.pendingRequests.length ?? 0) === 0) setOpen(false);
      });
    },
    [refresh],
  );

  if (!status?.enabled) return null;

  const pendingCount = status.pendingRequests.length;
  const controlsDisabled = !bridge || busyAction !== null;
  const activeChainId = status.chain?.chainId ?? null;
  const listedBuiltIn = enabledBuiltInNetworks(walletSettings.disabledBuiltInChainIds);
  const customNetworks = walletSettings.customNetworks;
  const activeBuiltIn = listedBuiltIn.find((network) => network.chainId === activeChainId);
  const activeCustom =
    activeChainId === null ? null : findCustomNetwork(customNetworks, activeChainId);
  const activeChainUsesBundledRpc =
    activeBuiltIn !== undefined && activeBuiltIn.rpcUrl === status.chain?.rpcUrl;
  const activeChainUsesCustomRpc =
    activeCustom !== null && activeCustom.rpcUrl === status.chain?.rpcUrl;
  const activeNetworkValue =
    activeChainId === null
      ? "no-network"
      : activeChainUsesCustomRpc
        ? `custom:${activeChainId}`
        : activeChainUsesBundledRpc
          ? `network:${activeChainId}`
          : `current:${activeChainId}`;
  const activeAccount = status.accounts.find(
    (account) => account.address === status.selectedAddress,
  );
  const chipLabel =
    pendingCount > 0
      ? `Preview wallet, ${pendingCount} request${pendingCount === 1 ? "" : "s"} awaiting approval`
      : "Preview wallet";
  const accountRow = {
    accounts: status.accounts,
    activeAccount,
    selectedAddress: status.selectedAddress,
    disabled: controlsDisabled,
    renaming,
    onSelect: (address: string) =>
      void configure(
        `account:${address}`,
        { selectedAddress: address },
        "Could not switch account",
      ),
    onStartRename: () => setRenaming(true),
    onFinishRename: () => setRenaming(false),
    onCommitLabel: (address: string, nextLabel: string) =>
      void configure(
        `label:${address}`,
        { accountLabel: { address, label: nextLabel } },
        "Could not rename account",
      ),
    onRemove: () => {
      if (activeAccount !== undefined) void confirmRemoveAccount(activeAccount);
    },
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="relative"
                  aria-label={chipLabel}
                />
              }
            />
          }
        >
          <WalletIcon aria-hidden />
          {pendingCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-medium text-white">
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup>{chipLabel}</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        align="end"
        sideOffset={6}
        className="w-[22.5rem]"
        viewportClassName="px-3 py-3 [--viewport-inline-padding:--spacing(3)]"
        onPointerEnter={() => {
          pointerInsidePopup.current = true;
        }}
        onPointerLeave={() => {
          pointerInsidePopup.current = false;
        }}
      >
        <PopoverTitle className="sr-only">Preview wallet</PopoverTitle>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Select
              value={activeNetworkValue}
              onValueChange={(value) => {
                if (typeof value !== "string" || value === activeNetworkValue) return;
                if (value.startsWith("custom:")) {
                  const chainId = Number(value.slice("custom:".length));
                  const custom = findCustomNetwork(customNetworks, chainId);
                  if (custom === null || !Number.isSafeInteger(chainId) || chainId <= 0) {
                    return;
                  }
                  updateSettings({
                    web3Wallet: { chainId, rpcUrl: custom.rpcUrl },
                  });
                  void configure(
                    `custom:${chainId}`,
                    { chainId, rpcUrl: custom.rpcUrl },
                    "Could not switch network",
                  );
                  return;
                }
                if (!value.startsWith("network:")) return;
                const chainId = Number(value.slice("network:".length));
                if (!Number.isSafeInteger(chainId) || chainId <= 0) return;
                updateSettings({ web3Wallet: { chainId, rpcUrl: null } });
                void configure(
                  `network:${chainId}`,
                  { chainId, rpcUrl: null },
                  "Could not switch network",
                );
              }}
            >
              <SelectTrigger
                variant="ghost"
                size="xs"
                className="h-7 max-w-[13rem] rounded-full bg-accent/70 px-2"
                aria-label="Preview wallet network"
                disabled={controlsDisabled}
              >
                {activeChainId === null ? null : <NetworkIcon chainId={activeChainId} />}
                <SelectValue>{status.chain?.name ?? "No network"}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false} matchTriggerWidth={false}>
                {status.chain !== null &&
                !activeChainUsesBundledRpc &&
                !activeChainUsesCustomRpc ? (
                  <SelectItem
                    hideIndicator
                    key={`current:${status.chain.chainId}`}
                    value={`current:${status.chain.chainId}`}
                  >
                    <span className="flex items-center gap-2">
                      <NetworkIcon chainId={status.chain.chainId} />
                      {status.chain.name} ({status.chain.chainId}, custom)
                    </span>
                  </SelectItem>
                ) : null}
                {activeChainId === null ? (
                  <SelectItem hideIndicator disabled value="no-network">
                    No network
                  </SelectItem>
                ) : null}
                {listedBuiltIn.map((network) => (
                  <SelectItem
                    hideIndicator
                    key={network.chainId}
                    value={`network:${network.chainId}`}
                  >
                    <span className="flex items-center gap-2">
                      <NetworkIcon chainId={network.chainId} />
                      {network.name}
                    </span>
                  </SelectItem>
                ))}
                {customNetworks.map((network) => (
                  <SelectItem
                    hideIndicator
                    key={`custom:${network.chainId}`}
                    value={`custom:${network.chainId}`}
                  >
                    <span className="flex items-center gap-2">
                      <NetworkIcon chainId={network.chainId} />
                      {network.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <span className="text-[11px] text-muted-foreground">Test wallet</span>
          </div>

          {status.chain !== null && !status.rpcReachable ? (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-900 dark:text-amber-200">
              <TriangleAlertIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>RPC endpoint unreachable. Reads and transactions will fail.</span>
            </div>
          ) : null}

          {pendingCount === 0 ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <SelectedAccountAvatar
                address={status.selectedAddress}
                size={48}
                iconClassName="size-5 text-muted-foreground"
              />
              <ActiveAccountRow {...accountRow} align="center" />
              {status.selectedAddress === null ? null : (
                <CopyAddressButton address={status.selectedAddress} />
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-1 h-7 gap-1 px-2.5 text-xs"
                disabled={controlsDisabled}
                onClick={() =>
                  void configure(
                    "new-account",
                    { generateAccount: true },
                    "Could not create account",
                  )
                }
              >
                <PlusIcon className="size-3" aria-hidden />
                New account
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 border-t border-border pt-3">
              <SelectedAccountAvatar
                address={status.selectedAddress}
                size={32}
                iconClassName="size-3.5 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <ActiveAccountRow {...accountRow} align="start" />
                {status.selectedAddress === null ? null : (
                  <CopyAddressButton address={status.selectedAddress} />
                )}
              </div>
            </div>
          )}

          {pendingCount === 0 ? null : (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <span className="text-[11px] font-medium">
                {pendingCount === 1 ? "Approval request" : `${pendingCount} approval requests`}
              </span>
              {status.pendingRequests.map((request) => (
                <PendingRequestCard
                  key={request.requestId}
                  request={request}
                  onResolved={handleRequestResolved}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
