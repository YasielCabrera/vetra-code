import type { ProviderUsageRefreshIntervalMinutes } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

/**
 * Both settings are client-local: they schedule reads and raise alerts on the
 * device looking at the limits, not on the environment reporting them. They sit
 * on the Providers page rather than inside the per-environment provider list so
 * the device scope stays legible.
 */
const REFRESH_INTERVAL_OPTIONS = [
  { value: "off", minutes: null, label: "On load only" },
  { value: "5", minutes: 5, label: "Every 5 minutes" },
  { value: "15", minutes: 15, label: "Every 15 minutes" },
  { value: "30", minutes: 30, label: "Every 30 minutes" },
  { value: "60", minutes: 60, label: "Every 60 minutes" },
] as const satisfies ReadonlyArray<{
  readonly value: string;
  readonly minutes: ProviderUsageRefreshIntervalMinutes;
  readonly label: string;
}>;

const DEFAULT_REFRESH_INTERVAL_MINUTES =
  DEFAULT_UNIFIED_SETTINGS.providerUsageRefreshIntervalMinutes;
const DEFAULT_ALERTS_ENABLED = DEFAULT_UNIFIED_SETTINGS.providerUsageAlertsEnabled;

export function ProviderSubscriptionUsageSettings() {
  const refreshIntervalMinutes = useClientSettings(
    (settings) => settings.providerUsageRefreshIntervalMinutes,
  );
  const alertsEnabled = useClientSettings((settings) => settings.providerUsageAlertsEnabled);
  const updateSettings = useUpdateClientSettings();
  const selectedInterval =
    REFRESH_INTERVAL_OPTIONS.find((option) => option.minutes === refreshIntervalMinutes) ??
    REFRESH_INTERVAL_OPTIONS[0];

  return (
    <SettingsSection title="Subscription usage">
      <SettingsRow
        {...searchableSetting("subscription-usage-refresh")}
        description="How often this device asks every connected environment for fresh subscription allowances. On load only stops background polling; Refresh now on the Usage page still works."
        resetAction={
          refreshIntervalMinutes !== DEFAULT_REFRESH_INTERVAL_MINUTES ? (
            <SettingResetButton
              label="subscription usage refresh interval"
              onClick={() =>
                updateSettings({
                  providerUsageRefreshIntervalMinutes: DEFAULT_REFRESH_INTERVAL_MINUTES,
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={selectedInterval.value}
            onValueChange={(value) => {
              const option = REFRESH_INTERVAL_OPTIONS.find(
                (candidate) => candidate.value === value,
              );
              if (option) {
                updateSettings({ providerUsageRefreshIntervalMinutes: option.minutes });
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-40" aria-label="Subscription usage refresh">
              <SelectValue>{selectedInterval.label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {REFRESH_INTERVAL_OPTIONS.map((option) => (
                <SelectItem hideIndicator key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />

      <SettingsRow
        {...searchableSetting("subscription-limit-alerts")}
        description="Show an in-app alert when a subscription window first drops to 5% or less remaining, and again when an exhausted window becomes available. Alerts for the same provider instance are at least 10 minutes apart."
        resetAction={
          alertsEnabled !== DEFAULT_ALERTS_ENABLED ? (
            <SettingResetButton
              label="subscription limit alerts"
              onClick={() => updateSettings({ providerUsageAlertsEnabled: DEFAULT_ALERTS_ENABLED })}
            />
          ) : null
        }
        control={
          <Switch
            checked={alertsEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ providerUsageAlertsEnabled: Boolean(checked) })
            }
            aria-label="Enable subscription limit alerts"
          />
        }
      />
    </SettingsSection>
  );
}
