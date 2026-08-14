import type { PreviewSessionSnapshot } from "@vetra-code/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface } from "~/rightPanelStore";

import { RightPanelTabs } from "./RightPanelTabs";

const previewSurface: RightPanelSurface = {
  id: "browser:tab-1",
  kind: "preview",
  resourceId: "tab-1",
};

const previewSession: PreviewSessionSnapshot = {
  threadId: "thread-1",
  tabId: "tab-1",
  navStatus: {
    _tag: "Success",
    url: "http://localhost:5173/dashboard?mode=test#results",
    title: "Favicon Fixture",
  },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-08-13T00:00:00.000Z",
};

function renderTab(
  surface: RightPanelSurface,
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>,
) {
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="embedded"
      surfaces={[surface]}
      activeSurfaceId={surface.id}
      pendingSurfaceIds={new Set()}
      previewSessions={previewSessions}
      terminalLabelsById={new Map()}
      onActivate={() => undefined}
      onCloseSurface={() => undefined}
      onCloseOtherSurfaces={() => undefined}
      onCloseSurfacesToRight={() => undefined}
      onCloseAllSurfaces={() => undefined}
      onCopyFilePath={() => undefined}
      onAddBrowser={() => undefined}
      onAddTerminal={() => undefined}
      onAddDiff={() => undefined}
      onAddFiles={() => undefined}
      onAddPullRequest={() => undefined}
      onAddAgents={() => undefined}
      browserAvailable
      terminalAvailable
      diffAvailable
      filesAvailable
      pullRequestAvailable
      agentsAvailable
      liveAgentCount={0}
    >
      Preview content
    </RightPanelTabs>,
  );
}

describe("RightPanelTabs browser identity", () => {
  it("renders the active page favicon without changing its title", () => {
    const html = renderTab(previewSurface, { "tab-1": previewSession });

    expect(html).toContain('src="http://localhost:5173/favicon.ico"');
    expect(html).toContain('aria-label="Close Favicon Fixture"');
    expect(html).toContain(">Favicon Fixture</span>");
  });

  it("keeps the generic browser identity for a URL-less tab", () => {
    const html = renderTab({ id: "browser:new", kind: "preview", resourceId: null }, {});

    expect(html).not.toContain("<img");
    expect(html).toContain('aria-label="Close Browser"');
    expect(html).toContain(">Browser</span>");
  });
});
