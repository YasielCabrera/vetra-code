import { createFileRoute } from "@tanstack/react-router";

import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { Web3SettingsPanel } from "../components/settings/Web3SettingsPanel";

/** Each environment's server holds its own wallet, so the page shows one environment at a time. */
function SettingsWeb3Route() {
  const { environment, scope } = useSettingsScope();
  if (!environment) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {scope.kind === "environment"
          ? `Reconnect ${scope.label} to manage its preview wallet.`
          : "Connect an environment to manage its preview wallet."}
      </p>
    );
  }
  return <Web3SettingsPanel environmentId={environment.environmentId} />;
}

export const Route = createFileRoute("/settings/web3")({
  component: SettingsWeb3Route,
});
