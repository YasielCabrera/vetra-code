"use client";

import { parseScopedThreadKey } from "@vetra-code/client-runtime/environment";
import { FILL_PREVIEW_VIEWPORT } from "@vetra-code/contracts";
import { useEffect, useMemo } from "react";

import { isElectron } from "~/env";
import { usePrimarySettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { useActivePreviewSessions } from "~/previewStateStore";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserPointerStore } from "./browserPointerStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const { resolvedTheme } = useTheme();
  const web3Wallet = usePrimarySettings((settings) => settings.web3Wallet);
  const previewByThreadKey = useActivePreviewSessions();
  const sessions = useMemo(
    () =>
      Object.entries(previewByThreadKey).flatMap(([threadKey, previewState]) => {
        const threadRef = parseScopedThreadKey(threadKey);
        return threadRef
          ? Object.values(previewState.sessions).map((snapshot) => ({
              threadRef,
              snapshot,
              runtimeTabId: previewRuntimeTabId(
                threadRef,
                previewState.serverEpoch,
                snapshot.tabId,
              ),
              pictureInPicture:
                previewState.desktopByTabId[snapshot.tabId]?.pictureInPicture ?? false,
              zoomFactor: previewState.desktopByTabId[snapshot.tabId]?.zoomFactor ?? 1,
            }))
          : [];
      }),
    [previewByThreadKey],
  );

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;

    let lastSerializedTheme = "";
    const syncTheme = () => {
      const theme = readPreviewAnnotationTheme();
      const serializedTheme = JSON.stringify(theme);
      if (serializedTheme === lastSerializedTheme) return;
      lastSerializedTheme = serializedTheme;
      void preview.setAnnotationTheme(theme).catch(() => {
        lastSerializedTheme = "";
      });
    };
    const frameId = window.requestAnimationFrame(syncTheme);
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const headObserver = new MutationObserver(syncTheme);
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      headObserver.disconnect();
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onPointerEvent((event) => {
      useBrowserPointerStore.getState().apply(event);
    });
  }, []);

  // The main process reads settings.json for its startup value, but nothing
  // notifies it when the server rewrites the file. Pushing the wallet block
  // from here is what makes toggling Settings > Web3 take effect without a
  // desktop restart.
  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    void preview.wallet
      .applySettings({
        enabled: web3Wallet.enabled,
        approvalMode: web3Wallet.approvalMode,
        chainId: web3Wallet.chainId,
        rpcUrl: web3Wallet.rpcUrl,
        autoConnectLoopback: web3Wallet.autoConnectLoopback,
        disabledBuiltInChainIds: web3Wallet.disabledBuiltInChainIds,
        customNetworks: web3Wallet.customNetworks,
      })
      .catch(() => {
        // An older main process has no wallet bridge; the preview still works.
      });
  }, [web3Wallet]);

  if (!isElectron) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {sessions.map(({ threadRef, snapshot, runtimeTabId, pictureInPicture, zoomFactor }) => {
        const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
        return (
          <HostedBrowserWebview
            key={runtimeTabId}
            threadRef={threadRef}
            tabId={snapshot.tabId}
            runtimeTabId={runtimeTabId}
            initialUrl={url}
            viewport={snapshot.viewport ?? FILL_PREVIEW_VIEWPORT}
            pictureInPicture={pictureInPicture}
            zoomFactor={zoomFactor}
          />
        );
      })}
    </div>
  );
}
