/**
 * Brand icons for the wallet's built-in networks, with the color dot as the
 * fallback for custom chains.
 *
 * Each icon is imported one module deep rather than from the `@web3icons/react`
 * root. The root barrel re-exports every icon in the catalog (~2,200 modules),
 * so importing from it makes correct output depend on tree shaking and makes
 * dev pre-bundling crawl the whole set. Deep paths let the bundler see only the
 * eight networks we ship.
 *
 * @module NetworkIcon
 */
import NetworkArbitrumOne from "@web3icons/react/icons/networks/NetworkArbitrumOne";
import NetworkAvalanche from "@web3icons/react/icons/networks/NetworkAvalanche";
import NetworkBase from "@web3icons/react/icons/networks/NetworkBase";
import NetworkBinanceSmartChain from "@web3icons/react/icons/networks/NetworkBinanceSmartChain";
import NetworkEthereum from "@web3icons/react/icons/networks/NetworkEthereum";
import NetworkOptimism from "@web3icons/react/icons/networks/NetworkOptimism";
import NetworkPolygon from "@web3icons/react/icons/networks/NetworkPolygon";
import NetworkSepolia from "@web3icons/react/icons/networks/NetworkSepolia";

import { cn } from "~/lib/utils";
import { networkSwatchClass } from "~/components/settings/web3Settings.logic";

/** Every generated icon shares one signature, so borrow it instead of restating it. */
type Web3IconComponent = typeof NetworkEthereum;

/**
 * Keyed by the chain ids in `DEFAULT_WEB3_NETWORKS`. A network missing here
 * renders the dot, so adding a built-in network degrades rather than breaks.
 */
const BUILT_IN_NETWORK_ICONS: Readonly<Record<number, Web3IconComponent>> = {
  1: NetworkEthereum,
  10: NetworkOptimism,
  56: NetworkBinanceSmartChain,
  137: NetworkPolygon,
  8453: NetworkBase,
  42161: NetworkArbitrumOne,
  43114: NetworkAvalanche,
  11155111: NetworkSepolia,
};

type NetworkIconProps = {
  chainId: number;
  /** Box size in pixels. Custom chains center their dot in the same footprint. */
  size?: number;
  className?: string;
};

/**
 * Decorative by design: every call site already renders the network name, so the
 * icon is `aria-hidden` and adds no duplicate label for screen readers.
 */
export function NetworkIcon({ chainId, size = 14, className }: NetworkIconProps) {
  const Icon = BUILT_IN_NETWORK_ICONS[chainId];

  if (Icon === undefined) {
    return (
      <span
        className={cn("flex shrink-0 items-center justify-center", className)}
        style={{ width: size, height: size }}
        aria-hidden
      >
        <span className={cn("size-2 rounded-full", networkSwatchClass(chainId))} />
      </span>
    );
  }

  // `variant` defaults to whichever variant the icon happens to list first, so
  // pass it explicitly to keep rendering consistent across networks.
  return (
    <Icon
      variant="branded"
      size={size}
      className={cn("shrink-0 rounded-full", className)}
      aria-hidden
    />
  );
}
