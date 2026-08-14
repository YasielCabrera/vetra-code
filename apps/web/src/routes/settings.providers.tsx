import { createFileRoute, useLocation } from "@tanstack/react-router";
import type { EnvironmentId, ProviderInstanceId } from "@vetra-code/contracts";

import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";

const decodeHashComponent = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};

function SettingsProvidersRoute() {
  const hash = useLocation({ select: (location) => location.hash });
  const match = hash.replace(/^#/u, "").match(/^provider-instance\/([^/]+)\/([^/]+)$/u);
  const decodedEnvironmentId = decodeHashComponent(match?.[1]);
  const decodedInstanceId = decodeHashComponent(match?.[2]);
  const targetEnvironmentId = decodedEnvironmentId as EnvironmentId | undefined;
  const targetInstanceId = decodedInstanceId as ProviderInstanceId | undefined;
  return (
    <ProviderSettingsPanel
      targetEnvironmentId={targetEnvironmentId}
      targetInstanceId={targetInstanceId}
    />
  );
}

export const Route = createFileRoute("/settings/providers")({
  component: SettingsProvidersRoute,
});
