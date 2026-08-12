/**
 * Public and persistence-bearing identity for this fork.
 *
 * Keep values that can collide with another installed application here. Public
 * and internal identifiers use Vetra-owned names; do not add fallback aliases
 * that could silently reconnect this runtime to another product's state.
 */
export const PRODUCT_NAME = "Vetra Studio";
export const PRODUCT_SLUG = "vetra-studio";
export const PRODUCT_CLI_NAME = "vetra";
export const PRODUCT_SERVER_PACKAGE = "@vetra-studio/server";

export const PRODUCT_HOME_DIRECTORY_NAME = ".vetra-studio";
export const PRODUCT_PROJECT_CONFIG_DIRECTORY_NAME = ".vetra";
export const PRODUCT_PROJECT_FILE_NAME = "vetra.json";
export const PRODUCT_SESSION_COOKIE_NAME = "vetra_session";

export const PRODUCT_DEFAULT_SERVER_PORT = 4873;
export const PRODUCT_DEV_SERVER_PORT = 14873;
export const PRODUCT_DEV_WEB_PORT = 6733;

export const PRODUCT_DESKTOP_APP_ID = "com.vetra.studio";
export const PRODUCT_DESKTOP_DEV_APP_ID = "com.vetra.studio.dev";
export const PRODUCT_DESKTOP_USER_DATA_DIRECTORY_NAME = PRODUCT_SLUG;
export const PRODUCT_DESKTOP_DEV_USER_DATA_DIRECTORY_NAME = `${PRODUCT_SLUG}-dev`;
export const PRODUCT_DESKTOP_PROTOCOL = "vetra";
export const PRODUCT_DESKTOP_DEV_PROTOCOL = "vetra-dev";

export const PRODUCT_WORKTREE_BRANCH_PREFIX = "vetra";
export const PRODUCT_CHECKPOINT_REFS_PREFIX = "refs/vetra/checkpoints";
export const PRODUCT_PRE_REFRESH_REF_PREFIX = "refs/vetra/pre-refresh";

// Reserved until Vetra Studio has its own hosted control plane. This prevents a
// local fork from silently sending users through the upstream production app.
export const PRODUCT_DEFAULT_HOSTED_APP_URL = "https://app.vetra.invalid";
