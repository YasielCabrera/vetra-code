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
import type { Web3Account, Web3ApprovalMode } from "@vetra-code/web3/schema";
import { CheckIcon, CopyIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { previewBridge } from "../preview/previewBridge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
  parseChainIdInput,
  parseRpcUrlInput,
  removeAccountConfirmationMessage,
  shortenAddress,
} from "./web3Settings.logic";
import { useWalletStatus } from "./useWalletStatus";

const DEFAULTS = DEFAULT_SERVER_SETTINGS.web3Wallet;

function TestWalletWarning() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <p>
        This is a <strong>test wallet</strong>. Keys are stored unencrypted on this machine. Never
        import a mnemonic or private key that holds real funds.
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

export function Web3SettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const wallet = settings.web3Wallet;
  const { status, refresh } = useWalletStatus();

  // Text inputs stay local until they parse, so a half-typed URL does not get
  // written to settings on every keystroke.
  const [chainIdDraft, setChainIdDraft] = useState(
    wallet.chainId === null ? "" : String(wallet.chainId),
  );
  const [rpcUrlDraft, setRpcUrlDraft] = useState(wallet.rpcUrl ?? "");
  useEffect(() => {
    setChainIdDraft(wallet.chainId === null ? "" : String(wallet.chainId));
  }, [wallet.chainId]);
  useEffect(() => {
    setRpcUrlDraft(wallet.rpcUrl ?? "");
  }, [wallet.rpcUrl]);

  const bridge = previewBridge?.wallet ?? null;

  const pushWalletSettings = useCallback(async () => {
    if (!bridge) return;
    await bridge.applySettings({
      enabled: wallet.enabled,
      approvalMode: wallet.approvalMode,
      chainId: wallet.chainId,
      rpcUrl: wallet.rpcUrl,
      autoConnectLoopback: wallet.autoConnectLoopback,
    });
  }, [
    bridge,
    wallet.approvalMode,
    wallet.autoConnectLoopback,
    wallet.chainId,
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
                    {active ? (
                      <span className="px-2 text-[10px] font-medium text-muted-foreground">
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
          description="Leave empty to prefer a local node, then Ethereum Mainnet. Common networks switch automatically; fill these fields to pin a custom target."
          status={chainSummary || undefined}
          resetAction={
            wallet.chainId !== DEFAULTS.chainId || wallet.rpcUrl !== DEFAULTS.rpcUrl ? (
              <SettingResetButton
                label="the wallet network"
                onClick={() =>
                  updateSettings({
                    web3Wallet: { chainId: DEFAULTS.chainId, rpcUrl: DEFAULTS.rpcUrl },
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full flex-col gap-2 sm:w-72">
              <Input
                value={chainIdDraft}
                inputMode="numeric"
                placeholder="Chain ID (e.g. 31337)"
                aria-label="Wallet chain id"
                disabled={!wallet.enabled}
                onChange={(event) => setChainIdDraft(event.target.value)}
                onBlur={() => {
                  const parsed = parseChainIdInput(chainIdDraft);
                  if (parsed.valid) updateSettings({ web3Wallet: { chainId: parsed.value } });
                  else setChainIdDraft(wallet.chainId === null ? "" : String(wallet.chainId));
                }}
              />
              <Input
                value={rpcUrlDraft}
                placeholder="RPC URL (e.g. http://127.0.0.1:8545)"
                aria-label="Wallet RPC URL"
                disabled={!wallet.enabled}
                onChange={(event) => setRpcUrlDraft(event.target.value)}
                onBlur={() => {
                  const parsed = parseRpcUrlInput(rpcUrlDraft);
                  if (parsed.valid) updateSettings({ web3Wallet: { rpcUrl: parsed.value } });
                  else setRpcUrlDraft(wallet.rpcUrl ?? "");
                }}
              />
            </div>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
