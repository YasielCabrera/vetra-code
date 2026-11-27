/**
 * Values that would collide with another installed application: what a user reads,
 * what is persisted, what is published. Internal names stay upstream's `t3*`.
 * No fallback aliases: one would silently reconnect this runtime to T3's state.
 */
export const PRODUCT_NAME = "Vetra Code";
export const PRODUCT_SLUG = "vetra-code";
export const PRODUCT_CLI_NAME = "vetra";
/**
 * The npm package `service install` and `selfUpdate` resolve. Never the server
 * workspace's name (`t3`): T3 publishes that, so the updater would fetch their
 * releases. Reserved and unpublished, so an install fails loudly.
 */
export const PRODUCT_SERVER_PACKAGE = "@vetra-code/server";

export const PRODUCT_HOME_DIRECTORY_NAME = ".vetra-code";
export const PRODUCT_PROJECT_CONFIG_DIRECTORY_NAME = ".vetra";
export const PRODUCT_SESSION_COOKIE_NAME = "vetra_session";

export const PRODUCT_DEFAULT_SERVER_PORT = 4873;
export const PRODUCT_DEV_SERVER_PORT = 14873;
export const PRODUCT_DEV_WEB_PORT = 6733;

export const PRODUCT_DESKTOP_APP_ID = "com.vetra.code";
export const PRODUCT_DESKTOP_DEV_APP_ID = "com.vetra.code.dev";
export const PRODUCT_DESKTOP_USER_DATA_DIRECTORY_NAME = PRODUCT_SLUG;
export const PRODUCT_DESKTOP_DEV_USER_DATA_DIRECTORY_NAME = `${PRODUCT_SLUG}-dev`;
export const PRODUCT_DESKTOP_PROTOCOL = "vetra";
export const PRODUCT_DESKTOP_DEV_PROTOCOL = "vetra-dev";

export const PRODUCT_WORKTREE_BRANCH_PREFIX = "vetra";
export const PRODUCT_PRE_REFRESH_REF_PREFIX = "refs/vetra/pre-refresh";

// Reserved until Vetra Code has its own hosted control plane. This prevents a
// local fork from silently sending users through the upstream production app.
export const PRODUCT_DEFAULT_HOSTED_APP_URL = "https://app.vetra.invalid";
