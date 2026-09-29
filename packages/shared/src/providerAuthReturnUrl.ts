import { isLoopbackHost } from "./preview.ts";
import {
  PRODUCT_DEFAULT_HOSTED_APP_URL,
  PRODUCT_DESKTOP_DEV_PROTOCOL,
  PRODUCT_DESKTOP_PROTOCOL,
} from "./productIdentity.ts";

/** Only return to a local client or the hosted client, never an arbitrary OAuth-supplied URL. */
export function providerAuthReturnUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const desktop =
      [`${PRODUCT_DESKTOP_PROTOCOL}:`, `${PRODUCT_DESKTOP_DEV_PROTOCOL}:`].includes(url.protocol) &&
      url.host === "app";
    const web =
      ["http:", "https:"].includes(url.protocol) &&
      (isLoopbackHost(url.hostname) ||
        url.origin === new URL(PRODUCT_DEFAULT_HOSTED_APP_URL).origin);
    if (
      url.username ||
      url.password ||
      (!desktop && !web) ||
      (url.pathname !== "/welcome" &&
        url.pathname !== "/settings" &&
        !url.pathname.startsWith("/settings/"))
    )
      return undefined;
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        url.pathname === "/welcome" ||
        !["machine", "project", "checkout", "environmentId", "instanceId"].includes(key)
      ) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== "/welcome" || !/^#agents:[\w-]+$/u.test(url.hash)) url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
