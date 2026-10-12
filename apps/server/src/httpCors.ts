import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";
import {
  PRODUCT_DESKTOP_DEV_PROTOCOL,
  PRODUCT_DESKTOP_PROTOCOL,
} from "@t3tools/shared/productIdentity";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

/** Origins of the Electron renderer, packaged and dev. */
export const DESKTOP_RENDERER_ORIGINS = [
  `${PRODUCT_DESKTOP_PROTOCOL}://app`,
  `${PRODUCT_DESKTOP_DEV_PROTOCOL}://app`,
] as const;
