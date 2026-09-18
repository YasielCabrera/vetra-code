import type { ScopedThreadRef } from "@t3tools/contracts";
import { DiscoveryListRow } from "../ui/discovery-list";

import { PreviewFaviconIcon } from "./PreviewFaviconIcon";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: ScopedThreadRef;
  server: PreviewableServer;
  faviconSourceUrl: string;
  onOpen: () => void;
}

export function PreviewLocalServerCard({ threadRef, server, faviconSourceUrl, onOpen }: Props) {
  const subtitle = describeServer(server);
  return (
    <DiscoveryListRow
      onClick={onOpen}
      icon={
        <PreviewFaviconIcon
          threadRef={threadRef}
          url={server.requestedUrl}
          fallbackUrl={faviconSourceUrl}
        />
      }
      title={subtitle}
      description={`${server.host}:${server.port}`}
    />
  );
}

function describeServer(server: PreviewableServer): string {
  if (server.processName) return server.processName;
  return "Listening";
}
