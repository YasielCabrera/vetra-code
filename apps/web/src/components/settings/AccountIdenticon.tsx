import { cn } from "~/lib/utils";

import { identiconPattern } from "./web3Settings.logic";

export function AccountIdenticon({
  address,
  size = 32,
  className,
}: {
  readonly address: string;
  readonly size?: number;
  readonly className?: string;
}) {
  const pattern = identiconPattern(address);
  return (
    <span
      className={cn("inline-flex shrink-0 overflow-hidden rounded-full", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox="0 0 5 5" shapeRendering="crispEdges">
        <rect width="5" height="5" fill={`hsl(${pattern.hue} 42% 18%)`} />
        {pattern.cells.map((cell) => (
          <rect
            key={`${cell.x}-${cell.y}`}
            x={cell.x}
            y={cell.y}
            width="1"
            height="1"
            fill={`hsl(${pattern.hue} 72% 62%)`}
          />
        ))}
      </svg>
    </span>
  );
}
