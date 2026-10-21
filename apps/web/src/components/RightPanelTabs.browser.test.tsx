import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { RightPanelTabs } from "./RightPanelTabs";

const noop = () => undefined;

function Launcher({
  available,
  onOpen = noop,
}: {
  available: boolean;
  onOpen?: Parameters<typeof RightPanelTabs>[0]["onAddPowerhouse"];
}) {
  return (
    <RightPanelTabs
      mode="inline"
      open
      keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
      getShortcutContext={() => ({
        terminalFocus: false,
        terminalOpen: false,
        previewFocus: false,
        previewOpen: false,
        isWeb: true,
        isDesktop: false,
      })}
      surfaces={[]}
      environmentId={null}
      activeSurfaceId={null}
      pendingSurfaceIds={new Set()}
      previewSessions={{}}
      desktopByTabId={{}}
      terminalLabelsById={new Map()}
      onActivate={noop}
      onCloseSurface={noop}
      onCloseOtherSurfaces={noop}
      onCloseSurfacesToRight={noop}
      onCloseAllSurfaces={noop}
      onCopyFilePath={noop}
      onAddBrowser={noop}
      onAddBrowserInProfile={noop}
      onAddTerminal={noop}
      onAddPullRequest={noop}
      onAddPullRequests={noop}
      onAddDiff={noop}
      onAddFiles={noop}
      onAddPowerhouse={onOpen}
      onAddDevice={noop}
      browserAvailable={false}
      terminalAvailable={false}
      diffAvailable={false}
      filesAvailable={false}
      pullRequestAvailable={false}
      pullRequestsAvailable={false}
      powerhouseAvailable={available}
      deviceAvailable={false}
      children={null}
    />
  );
}

it("opens the selected tool from a Powerhouse workspace", async () => {
  const open = vi.fn();
  await using screen = await render(<Launcher available onOpen={open} />);
  await userEvent.click(screen.getByRole("button", { name: /Document explorer/ }));
  expect(open).toHaveBeenCalledExactlyOnceWith("powerhouse-explorer");
});

it("hides Powerhouse tools outside a Powerhouse workspace", async () => {
  await using screen = await render(<Launcher available={false} />);
  for (const title of [
    "Document models",
    "Document explorer",
    "Powerhouse Database",
    "Switchboard",
  ]) {
    expect(screen.container.textContent).not.toContain(title);
  }
});
