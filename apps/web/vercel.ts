import { routes, type VercelConfig } from "@vercel/config/v1";

/**
 * Static hosted renderer configuration.
 *
 * Vetra intentionally has no inherited production router or upstream channel
 * origins. A Vetra-owned deployment can add channel routing when that
 * infrastructure exists.
 */
export const config: VercelConfig = {
  buildCommand: "vp run --filter @vetra-code/web build",
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "npm install -g vite-plus && vp install --ignore-scripts --filter '@vetra-code/scripts...' --filter '@vetra-code/web...'",
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
