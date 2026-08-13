/**
 * Settings > Web3.
 *
 * Configures the preview wallet: a throwaway EIP-1193 signer injected into the
 * browser preview so dapp flows (connect, sign, send, chain switch) can be
 * exercised by a person or driven by an agent through the `preview_wallet_*`
 * MCP tools.
 */
import {
  DEFAULT_SERVER_SETTINGS,
  type PreviewAutomationWalletConfigureInput,
} from "@vetra-code/contracts";
import {
  DEFAULT_WEB3_NETWORKS,
  nextChainSelectionAfterCatalogChange,
  nextChainSelectionAfterCustomNetworkEdit,
  replaceCustomNetwork,
  setBuiltInNetworkEnabled,
} from "@vetra-code/web3/networks";
import type { Web3Account, Web3ApprovalMode, Web3CustomNetwork } from "@vetra-code/web3/schema";
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { previewBridge } from "../preview/previewBridge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { NetworkIcon } from "../web3/NetworkIcon";
import { AccountIdenticon } from "./AccountIdenticon";
import { AccountLabelEditor } from "./AccountLabelEditor";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  APPROVAL_MODE_OPTIONS,
  describeWalletChain,
  parseCustomNetworkDraft,
  removeAccountConfirmationMessage,
  removeCustomNetworkConfirmationMessage,
  shortenAddress,
} from "./web3Settings.logic";
import { useWalletStatus } from "./useWalletStatus";

const DEFAULTS = DEFAULT_SERVER_SETTINGS.web3Wallet;

function TestWalletWarning() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>
        This is a <strong>test wallet</strong>. Keys are unencrypted, and agents can use, create, or
        delete wallets without notice. Never import a mnemonic or private key that holds real funds.
      </p>
    </div>
  );
}

function CopyableAddress({ address }: { readonly address: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 font-mono text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => setCopied(true));
      }}
      aria-label={`Copy ${address}`}
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

function CustomNetworkDialog({
  open,
  editing,
  customNetworks,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly editing: Web3CustomNetwork | null;
  readonly customNetworks: readonly Web3CustomNetwork[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (network: Web3CustomNetwork) => void;
}) {
  const [name, setName] = useState("");
  const [chainId, setChainId] = useState("");
  const [rpcUrl, setRpcUrl] = useState("");
  const [currencySymbol, setCurrencySymbol] = useState("ETH");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setChainId(String(editing.chainId));
      setRpcUrl(editing.rpcUrl);
      setCurrencySymbol(editing.nativeCurrency.symbol);
    } else {
      setName("");
      setChainId("");
      setRpcUrl("");
      setCurrencySymbol("ETH");
    }
    setError(null);
  }, [editing, open]);

  const submit = () => {
    const parsed = parseCustomNetworkDraft(
      { name, chainId, rpcUrl, currencySymbol },
      customNetworks,
      editing?.chainId ?? null,
    );
    if (!parsed.valid) {
      setError(parsed.error);
      return;
    }
    onSubmit(parsed.network);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit custom network" : "Add custom network"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the name, RPC URL, chain ID, or currency for this network."
              : "Use this for a local node or any chain that is not in the built-in list."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="web3-custom-network-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex w-full flex-col gap-1.5">
              <Label htmlFor="web3-custom-network-name">Network name</Label>
              <Input
                id="web3-custom-network-name"
                value={name}
                placeholder="Anvil"
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex w-full flex-col gap-1.5">
              <Label htmlFor="web3-custom-network-rpc">RPC URL</Label>
              <Input
                id="web3-custom-network-rpc"
                value={rpcUrl}
                placeholder="http://127.0.0.1:8545"
                autoComplete="off"
                onChange={(event) => setRpcUrl(event.target.value)}
              />
            </div>
            <div className="flex w-full flex-col gap-1.5">
              <Label htmlFor="web3-custom-network-chain-id">Chain ID</Label>
              <Input
                id="web3-custom-network-chain-id"
                value={chainId}
                inputMode="numeric"
                placeholder="31337"
                autoComplete="off"
                onChange={(event) => setChainId(event.target.value)}
              />
            </div>
            <div className="flex w-full flex-col gap-1.5">
              <Label htmlFor="web3-custom-network-symbol">Currency symbol</Label>
              <Input
                id="web3-custom-network-symbol"
                value={currencySymbol}
                placeholder="ETH"
                autoComplete="off"
                onChange={(event) => setCurrencySymbol(event.target.value)}
              />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="web3-custom-network-form">
            {editing ? "Save" : "Add network"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function Web3SettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const wallet = settings.web3Wallet;
  const { status, refresh } = useWalletStatus();
  const [networkDialog, setNetworkDialog] = useState<Web3CustomNetwork | "add" | null>(null);

  const bridge = previewBridge?.wallet ?? null;

  const pushWalletSettings = useCallback(async () => {
    if (!bridge) return;
    await bridge.applySettings({
      enabled: wallet.enabled,
      approvalMode: wallet.approvalMode,
      chainId: wallet.chainId,
      rpcUrl: wallet.rpcUrl,
      autoConnectLoopback: wallet.autoConnectLoopback,
      disabledBuiltInChainIds: wallet.disabledBuiltInChainIds,
      customNetworks: wallet.customNetworks,
    });
  }, [
    bridge,
    wallet.approvalMode,
    wallet.autoConnectLoopback,
    wallet.chainId,
    wallet.customNetworks,
    wallet.disabledBuiltInChainIds,
    wallet.enabled,
    wallet.rpcUrl,
  ]);

  // ElectronBrowserHost also pushes this, but Settings is where a stale
  // "wallet is off" is visible — retry here so toggling on actually seeds
  // the keystore even if the host effect ran before the wallet IPC was ready.
  useEffect(() => {
    if (!bridge) return;
    void pushWalletSettings()
      .then(() => refresh())
      .catch(() => undefined);
  }, [bridge, pushWalletSettings, refresh]);

  const runWalletConfigure = useCallback(
    async (input: PreviewAutomationWalletConfigureInput, failedTitle: string) => {
      if (!bridge) return;
      try {
        await pushWalletSettings();
        await bridge.configure("", input);
        await refresh();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: failedTitle,
          description:
            error instanceof Error ? error.message : "The preview wallet did not respond.",
        });
      }
    },
    [bridge, pushWalletSettings, refresh],
  );

  const generateAccount = useCallback(async () => {
    await runWalletConfigure({ generateAccount: true }, "Could not add an account");
  }, [runWalletConfigure]);

  const clearOrigins = useCallback(async () => {
    await runWalletConfigure({ clearConnectedOrigins: true }, "Could not forget connected sites");
  }, [runWalletConfigure]);

  const selectAccount = useCallback(
    async (address: string) => {
      await runWalletConfigure({ selectedAddress: address }, "Could not switch the active account");
    },
    [runWalletConfigure],
  );

  const renameAccount = useCallback(
    async (address: string, nextLabel: string) => {
      await runWalletConfigure(
        { accountLabel: { address, label: nextLabel } },
        "Could not rename the account",
      );
    },
    [runWalletConfigure],
  );

  const removeAccount = useCallback(
    async (account: Web3Account) => {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        removeAccountConfirmationMessage(account),
        { variant: "destructive" },
      );
      if (!confirmed) return;
      await runWalletConfigure({ removeAccount: account.address }, "Could not remove the account");
    },
    [runWalletConfigure],
  );

  const toggleBuiltInNetwork = useCallback(
    (chainId: number, enabled: boolean) => {
      const disabledBuiltInChainIds = setBuiltInNetworkEnabled({
        chainId,
        enabled,
        disabledBuiltInChainIds: wallet.disabledBuiltInChainIds,
      });
      updateSettings({
        web3Wallet: enabled
          ? { disabledBuiltInChainIds }
          : {
              disabledBuiltInChainIds,
              ...nextChainSelectionAfterCatalogChange({
                chainId: wallet.chainId,
                rpcUrl: wallet.rpcUrl,
                removedOrDisabledChainId: chainId,
                disabledBuiltInChainIds,
                customNetworks: wallet.customNetworks,
              }),
            },
      });
    },
    [
      updateSettings,
      wallet.chainId,
      wallet.customNetworks,
      wallet.disabledBuiltInChainIds,
      wallet.rpcUrl,
    ],
  );

  const addCustomNetwork = useCallback(
    (network: Web3CustomNetwork) => {
      updateSettings({
        web3Wallet: {
          customNetworks: [...wallet.customNetworks, network],
          chainId: network.chainId,
          rpcUrl: network.rpcUrl,
        },
      });
    },
    [updateSettings, wallet.customNetworks],
  );

  const editCustomNetwork = useCallback(
    (previous: Web3CustomNetwork, next: Web3CustomNetwork) => {
      updateSettings({
        web3Wallet: {
          customNetworks: replaceCustomNetwork(wallet.customNetworks, previous.chainId, next),
          ...nextChainSelectionAfterCustomNetworkEdit({
            chainId: wallet.chainId,
            rpcUrl: wallet.rpcUrl,
            previousChainId: previous.chainId,
            next,
          }),
        },
      });
    },
    [updateSettings, wallet.chainId, wallet.customNetworks, wallet.rpcUrl],
  );

  const removeCustomNetwork = useCallback(
    async (network: Web3CustomNetwork) => {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        removeCustomNetworkConfirmationMessage(network),
        { variant: "destructive" },
      );
      if (!confirmed) return;
      const customNetworks = wallet.customNetworks.filter(
        (entry) => entry.chainId !== network.chainId,
      );
      updateSettings({
        web3Wallet: {
          customNetworks,
          ...nextChainSelectionAfterCatalogChange({
            chainId: wallet.chainId,
            rpcUrl: wallet.rpcUrl,
            removedOrDisabledChainId: network.chainId,
            disabledBuiltInChainIds: wallet.disabledBuiltInChainIds,
            customNetworks,
          }),
        },
      });
    },
    [
      updateSettings,
      wallet.chainId,
      wallet.customNetworks,
      wallet.disabledBuiltInChainIds,
      wallet.rpcUrl,
    ],
  );

  const chainSummary = describeWalletChain(status);

  return (
    <SettingsPageContainer>
      <SettingsSection id="web3-wallet" title="Preview wallet">
        <div className="px-1 pb-2">
          <TestWalletWarning />
        </div>

        <SettingsRow
          {...searchableSetting("web3-wallet-enabled")}
          description="Inject a MetaMask-compatible wallet into the browser preview. Restart the server after enabling so agents can use it."
          resetAction={
            wallet.enabled !== DEFAULTS.enabled ? (
              <SettingResetButton
                label="the preview wallet"
                onClick={() => updateSettings({ web3Wallet: { enabled: DEFAULTS.enabled } })}
              />
            ) : null
          }
          control={
            <Switch
              checked={wallet.enabled}
              onCheckedChange={(checked) =>
                updateSettings({ web3Wallet: { enabled: Boolean(checked) } })
              }
              aria-label="Enable the preview wallet"
            />
          }
        />

        <SettingsRow
          {...searchableSetting("web3-wallet-approval-mode")}
          description="Who confirms signatures and transactions."
          resetAction={
            wallet.approvalMode !== DEFAULTS.approvalMode ? (
              <SettingResetButton
                label="wallet approvals"
                onClick={() =>
                  updateSettings({ web3Wallet: { approvalMode: DEFAULTS.approvalMode } })
                }
              />
            ) : null
          }
          control={
            <Select
              value={wallet.approvalMode}
              onValueChange={(value) =>
                updateSettings({ web3Wallet: { approvalMode: value as Web3ApprovalMode } })
              }
            >
              <SelectTrigger
                className="w-full sm:w-52"
                aria-label="Wallet approval mode"
                disabled={!wallet.enabled}
              >
                <SelectValue>
                  {APPROVAL_MODE_OPTIONS.find((option) => option.value === wallet.approvalMode)
                    ?.label ?? wallet.approvalMode}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {APPROVAL_MODE_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          {...searchableSetting("web3-wallet-auto-connect")}
          description="Skip the connect prompt on localhost. Remote sites still need approval once."
          resetAction={
            wallet.autoConnectLoopback !== DEFAULTS.autoConnectLoopback ? (
              <SettingResetButton
                label="localhost auto-connect"
                onClick={() =>
                  updateSettings({
                    web3Wallet: { autoConnectLoopback: DEFAULTS.autoConnectLoopback },
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={wallet.autoConnectLoopback}
              onCheckedChange={(checked) =>
                updateSettings({ web3Wallet: { autoConnectLoopback: Boolean(checked) } })
              }
              disabled={!wallet.enabled}
              aria-label="Auto-connect localhost origins"
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="web3-accounts" title="Accounts">
        <SettingsRow
          {...searchableSetting("web3-wallet-accounts")}
          description={
            bridge
              ? "Generated when the wallet is first enabled. Click a name to rename it. The active account is returned first."
              : "Accounts are only available in the desktop app, where the browser preview runs."
          }
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void generateAccount()}
              disabled={!bridge || !wallet.enabled}
            >
              <PlusIcon className="size-3.5" aria-hidden />
              Add account
            </Button>
          }
        />

        {status && status.accounts.length > 0 ? (
          <div className="flex flex-col gap-1 px-1 pb-2">
            {status.accounts.map((account: Web3Account) => {
              const active = account.address === status.selectedAddress;
              return (
                <div
                  key={account.address}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-accent/50"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <AccountIdenticon address={account.address} size={20} />
                    <AccountLabelEditor
                      address={account.address}
                      label={account.label}
                      disabled={!bridge || !wallet.enabled}
                      className="text-xs font-medium"
                      onCommit={(address, nextLabel) => void renameAccount(address, nextLabel)}
                    />
                    {account.source === "imported" ? (
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        imported
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <CopyableAddress address={account.address} />
                    <div className="flex w-28 shrink-0 items-center justify-end">
                      {active ? (
                        <span className="inline-flex h-7 items-center px-2.5 text-xs font-medium text-muted-foreground">
                          Active
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => void selectAccount(account.address)}
                        >
                          Make active
                        </Button>
                      )}
                    </div>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${account.label}`}
                            disabled={!bridge || !wallet.enabled}
                            onClick={() => void removeAccount(account)}
                          />
                        }
                      >
                        <Trash2Icon />
                      </TooltipTrigger>
                      <TooltipPopup>Remove account</TooltipPopup>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <SettingsRow
          title="Connected sites"
          description={
            status && status.connectedOrigins.length > 0
              ? `Granted account access to ${status.connectedOrigins.join(", ")}.`
              : "No connected sites yet."
          }
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void clearOrigins()}
              disabled={!bridge || !status || status.connectedOrigins.length === 0}
            >
              Forget all
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection id="web3-network" title="Network">
        <SettingsRow
          {...searchableSetting("web3-wallet-chain")}
          description="Enabled networks appear in the preview wallet picker and can be selected by dapps."
          status={chainSummary || undefined}
          resetAction={
            wallet.disabledBuiltInChainIds.length > 0 ? (
              <SettingResetButton
                label="built-in networks"
                onClick={() => updateSettings({ web3Wallet: { disabledBuiltInChainIds: [] } })}
              />
            ) : null
          }
        />

        <div className="flex flex-col gap-1 px-1 pb-2">
          {DEFAULT_WEB3_NETWORKS.map((network) => {
            const enabled = !wallet.disabledBuiltInChainIds.includes(network.chainId);
            const active = status?.chain?.chainId === network.chainId;
            return (
              <div
                key={network.chainId}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-accent/50"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <NetworkIcon chainId={network.chainId} />
                  <span className="truncate text-xs font-medium">{network.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {network.chainId}
                  </span>
                  {active ? (
                    <span className="px-1 text-[10px] font-medium text-muted-foreground">
                      Active
                    </span>
                  ) : null}
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    toggleBuiltInNetwork(network.chainId, Boolean(checked))
                  }
                  disabled={!wallet.enabled}
                  aria-label={`${enabled ? "Disable" : "Enable"} ${network.name}`}
                />
              </div>
            );
          })}
        </div>

        <SettingsRow
          {...searchableSetting("web3-wallet-custom-networks")}
          description={
            wallet.customNetworks.length > 0
              ? "Add a local node or any EVM chain the built-in list does not cover."
              : "No custom networks yet. Add a local node or any EVM chain the built-in list does not cover."
          }
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNetworkDialog("add")}
              disabled={!wallet.enabled}
            >
              <PlusIcon className="size-3.5" aria-hidden />
              Add custom network
            </Button>
          }
        />

        {wallet.customNetworks.length > 0 ? (
          <div className="flex flex-col gap-1 px-1 pb-2">
            {wallet.customNetworks.map((network) => {
              const active = status?.chain?.chainId === network.chainId;
              return (
                <div
                  key={network.chainId}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-accent/50"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <NetworkIcon chainId={network.chainId} />
                    <span className="truncate text-xs font-medium">{network.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {network.chainId}
                    </span>
                    {active ? (
                      <span className="px-1 text-[10px] font-medium text-muted-foreground">
                        Active
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground"
                            aria-label={`Edit ${network.name}`}
                            disabled={!wallet.enabled}
                            onClick={() => setNetworkDialog(network)}
                          />
                        }
                      >
                        <PencilIcon />
                      </TooltipTrigger>
                      <TooltipPopup>Edit network</TooltipPopup>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${network.name}`}
                            disabled={!wallet.enabled}
                            onClick={() => void removeCustomNetwork(network)}
                          />
                        }
                      >
                        <Trash2Icon />
                      </TooltipTrigger>
                      <TooltipPopup>Remove network</TooltipPopup>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </SettingsSection>

      <CustomNetworkDialog
        open={networkDialog !== null}
        editing={networkDialog === "add" || networkDialog === null ? null : networkDialog}
        customNetworks={wallet.customNetworks}
        onOpenChange={(open) => {
          if (!open) setNetworkDialog(null);
        }}
        onSubmit={(network) => {
          if (networkDialog === "add" || networkDialog === null) addCustomNetwork(network);
          else editCustomNetwork(networkDialog, network);
        }}
      />
    </SettingsPageContainer>
  );
}
