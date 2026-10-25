import { createFileRoute } from "@tanstack/react-router";

import { TextToSpeechSettingsPanel } from "../components/settings/TextToSpeechSettingsPanel";

function SettingsReadAloudRoute() {
  return <TextToSpeechSettingsPanel />;
}

export const Route = createFileRoute("/_chat/settings/read-aloud")({
  component: SettingsReadAloudRoute,
});
