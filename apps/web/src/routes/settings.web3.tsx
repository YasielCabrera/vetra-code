import { createFileRoute } from "@tanstack/react-router";

import { Web3SettingsPanel } from "../components/settings/Web3SettingsPanel";

function SettingsWeb3Route() {
  return <Web3SettingsPanel />;
}

export const Route = createFileRoute("/settings/web3")({
  component: SettingsWeb3Route,
});
