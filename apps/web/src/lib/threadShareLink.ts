import type { ScopedThreadRef } from "@t3tools/contracts";
import { promptLinkDeepLink } from "@t3tools/shared/promptLinks";
import { formatHostedThreadLink, hostedThreadLink } from "@t3tools/shared/threadLinks";

/** Until Vetra hosts an app, a copied link opens in the desktop app or on this browser's server. */
export function shareableThreadLink(ref: ScopedThreadRef): string {
  const hostedAppUrl = import.meta.env.VITE_HOSTED_APP_URL?.trim();
  if (hostedAppUrl) return hostedThreadLink(ref, hostedAppUrl);
  if (typeof window === "undefined" || window.desktopBridge !== undefined) {
    return promptLinkDeepLink(
      `/${encodeURIComponent(ref.environmentId)}/${encodeURIComponent(ref.threadId)}`,
    );
  }
  return hostedThreadLink(ref, window.location.origin);
}

export function shareableThreadMarkdown(ref: ScopedThreadRef, title: string): string {
  return formatHostedThreadLink(ref, title).replace(
    hostedThreadLink(ref),
    shareableThreadLink(ref),
  );
}
