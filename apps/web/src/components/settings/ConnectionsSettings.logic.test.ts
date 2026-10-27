import type { AdvertisedEndpoint, DesktopWslState } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  applyWslEnableSelection,
  resolveMcpServerUrl,
  selectQrEndpointOption,
  togglePairingScopeSelection,
} from "./ConnectionsSettings.logic";

describe("togglePairingScopeSelection", () => {
  it.each([
    {
      label: "adds terminal:read when terminal:operate is selected",
      current: ["orchestration:read"],
      scope: "terminal:operate",
      checked: true,
      expected: ["orchestration:read", "terminal:operate", "terminal:read"],
    },
    {
      label: "drops terminal:operate when terminal:read is cleared",
      current: ["terminal:read", "terminal:operate", "relay:read"],
      scope: "terminal:read",
      checked: false,
      expected: ["relay:read"],
    },
    {
      label: "keeps terminal:read when terminal:operate is cleared",
      current: ["terminal:read", "terminal:operate"],
      scope: "terminal:operate",
      checked: false,
      expected: ["terminal:read"],
    },
    {
      label: "toggles unrelated scopes on their own",
      current: ["terminal:read"],
      scope: "filesystem:read",
      checked: true,
      expected: ["terminal:read", "filesystem:read"],
    },
  ] as const)("$label", ({ current, scope, checked, expected }) => {
    expect(togglePairingScopeSelection(current, scope, checked)).toEqual(expected);
  });
});

const baseWslState: DesktopWslState = {
  enabled: false,
  distro: null,
  available: true,
  wslOnly: true,
  distros: [],
  preflightError: null,
};

describe("applyWslEnableSelection", () => {
  it("clears WSL-only and updates the distro before enabling both backends", async () => {
    const calls: Array<string> = [];
    let persistedWslOnly = true;
    let persistedDistro: string | null = "Ubuntu";
    const setWslDistro = vi.fn(async (distro: string | null) => {
      calls.push(`setWslDistro:${distro ?? "default"}`);
      persistedDistro = distro;
      return { ...baseWslState, distro, wslOnly: persistedWslOnly };
    });
    const setWslBackendEnabled = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslBackendEnabled:${enabled}`);
      return {
        ...baseWslState,
        enabled,
        distro: persistedDistro,
        wslOnly: persistedWslOnly,
      };
    });
    const setWslOnly = vi.fn(async (enabled: boolean) => {
      calls.push(`setWslOnly:${enabled}`);
      persistedWslOnly = enabled;
      return { ...baseWslState, distro: persistedDistro, wslOnly: enabled };
    });

    const state = await applyWslEnableSelection({
      bridge: { setWslDistro, setWslBackendEnabled, setWslOnly },
      mode: "both",
      nextDistro: "Debian",
      persistedDistro: "Ubuntu",
    });

    expect(calls).toEqual(["setWslOnly:false", "setWslDistro:Debian", "setWslBackendEnabled:true"]);
    expect(state).toMatchObject({ enabled: true, distro: "Debian", wslOnly: false });
  });
});

describe("selectQrEndpointOption", () => {
  const options = [
    {
      id: "desktop-loopback:4780",
      preferenceKey: "desktop-core:loopback:http",
      qrShareable: false,
    },
    {
      id: "tailscale-ip:http://100.84.12.7:4780",
      preferenceKey: "tailscale:ip:http",
      qrShareable: true,
    },
    {
      id: "tailscale-ip:http://100.84.12.8:4780",
      preferenceKey: "tailscale:ip:http",
      qrShareable: true,
    },
    {
      id: "desktop-lan:http://192.168.1.42:4780",
      preferenceKey: "desktop-core:lan:http",
      qrShareable: true,
    },
  ];

  it("resolves an explicit selection by unique endpoint id, not the shared preference key", () => {
    expect(selectQrEndpointOption(options, "tailscale-ip:http://100.84.12.8:4780", null)?.id).toBe(
      "tailscale-ip:http://100.84.12.8:4780",
    );
  });

  it("skips non-QR-shareable options in the fallback so the panel never opens on loopback", () => {
    expect(selectQrEndpointOption(options, "tailscale-ip:gone", "nope")?.id).toBe(
      "tailscale-ip:http://100.84.12.7:4780",
    );
  });
});

describe("resolveMcpServerUrl", () => {
  const endpoint = (
    input: Pick<AdvertisedEndpoint, "id" | "httpBaseUrl" | "reachability"> &
      Partial<AdvertisedEndpoint>,
  ): AdvertisedEndpoint => ({
    label: input.id,
    provider: { id: "desktop-core", label: "Desktop", kind: "core", isAddon: false },
    wsBaseUrl: input.httpBaseUrl.replace(/^http/u, "ws"),
    compatibility: { hostedHttpsApp: "unknown", desktopApp: "compatible" },
    source: "desktop-core",
    status: "available",
    ...input,
  });
  const loopback = endpoint({
    id: "desktop-loopback:3773",
    httpBaseUrl: "http://127.0.0.1:3773",
    reachability: "loopback",
  });
  const lan = endpoint({
    id: "desktop-lan:192.168.1.20",
    httpBaseUrl: "http://192.168.1.20:3773",
    reachability: "lan",
  });
  const tailscale = endpoint({
    id: "tailscale-magicdns:box.example.ts.net",
    httpBaseUrl: "https://box.example.ts.net/",
    reachability: "private-network",
  });
  const local = { endpointUrl: null, environmentBaseUrl: "http://localhost:6733/" };

  it("prefers a reachable advertised address over loopback", () => {
    expect(
      resolveMcpServerUrl({ ...local, endpoints: [loopback, lan], defaultEndpointKey: null }),
    ).toBe("http://192.168.1.20:3773/mcp");
  });

  it("uses the address chosen as the default for pairing links", () => {
    expect(
      resolveMcpServerUrl({
        ...local,
        endpoints: [lan, tailscale],
        defaultEndpointKey: "tailscale:magicdns:https",
      }),
    ).toBe("https://box.example.ts.net/mcp");
  });

  it("falls back to the exposed endpoint, then this environment's own origin", () => {
    const unavailable = { ...tailscale, status: "unavailable" as const };
    expect(
      resolveMcpServerUrl({
        ...local,
        endpoints: [unavailable],
        defaultEndpointKey: null,
        endpointUrl: "http://192.168.1.20:3773",
      }),
    ).toBe("http://192.168.1.20:3773/mcp");
    expect(
      resolveMcpServerUrl({ ...local, endpoints: [unavailable], defaultEndpointKey: null }),
    ).toBe("http://localhost:6733/mcp");
  });
});
