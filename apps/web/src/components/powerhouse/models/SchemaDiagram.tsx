import { Graph, layout } from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  getNodesBounds,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  LoaderCircle,
  Maximize2,
  Minus,
  Plus,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useTheme } from "~/hooks/useTheme";

import {
  GRAPHQL_SCHEMA_DIAGRAM_LIMITS,
  parseGraphqlSchemaDiagram,
  presentGraphqlSchemaDeclaration,
  type GraphqlSchemaDeclaration,
  type GraphqlSchemaDeclarationPresentation,
  type GraphqlSchemaRelation,
} from "./graphqlSchemaDiagram";
import {
  copySchemaDiagramPng,
  downloadSchemaDiagramPng,
  renderSchemaDiagramPng,
  schemaDiagramPngFilename,
} from "./schemaDiagramPng";

const NODE_WIDTH = 272;
const NODE_HEADER_HEIGHT = 42;
const NODE_ROW_HEIGHT = 27;
const NODE_EMPTY_HEIGHT = 34;
const NODE_MORE_HEIGHT = 29;

type SchemaDeclarationNode = Node<
  {
    readonly declaration: GraphqlSchemaDeclaration;
    readonly presentation: GraphqlSchemaDeclarationPresentation;
    readonly expanded: boolean;
    readonly onToggleExpanded: (declarationId: string) => void;
  },
  "schemaDeclaration"
>;

const EMPTY_EXPANDED_DECLARATIONS: ReadonlySet<string> = new Set();

// React Flow uses the presence of a node pointer handler to decide whether a
// non-selectable node's wrapper can receive pointer events. The row buttons
// handle their own clicks; this callback keeps those descendants reachable.
const enableSchemaNodePointerEvents: NodeMouseHandler<SchemaDeclarationNode> = () => undefined;

const DECLARATION_LABELS: Record<GraphqlSchemaDeclaration["kind"], string> = {
  type: "Type",
  interface: "Interface",
  input: "Input",
  enum: "Enum",
  union: "Union",
  scalar: "Scalar",
};

function declarationHeight(presentation: GraphqlSchemaDeclarationPresentation): number {
  const bodyHeight =
    presentation.items.length === 0
      ? NODE_EMPTY_HEIGHT
      : presentation.items.length * NODE_ROW_HEIGHT +
        (presentation.expandable ? NODE_MORE_HEIGHT : 0);
  return NODE_HEADER_HEIGHT + bodyHeight;
}

function SchemaDeclarationCard({ data }: NodeProps<SchemaDeclarationNode>) {
  const { declaration, expanded, onToggleExpanded, presentation } = data;
  const kindLabel = DECLARATION_LABELS[declaration.kind];
  return (
    <div className="w-[17rem] overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      <Handle type="target" position={Position.Left} className="size-2! border-card! bg-primary!" />
      <div className="flex h-[2.625rem] min-w-0 items-center gap-2 border-b border-border/70 bg-muted/45 px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">
          {declaration.name}
        </span>
        <span className="shrink-0 rounded-sm border border-border/70 bg-background/70 px-1.5 py-0.5 text-3xs font-medium tracking-wide text-muted-foreground uppercase">
          {kindLabel}
        </span>
      </div>
      {presentation.items.length === 0 ? (
        <div className="flex h-[2.125rem] items-center px-3 text-3xs text-muted-foreground">
          {declaration.kind === "scalar" ? "Custom scalar" : "No members"}
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {presentation.items.map((item) => (
            <div
              key={`${item.name}:${item.detail ?? ""}`}
              className="flex h-[1.6875rem] min-w-0 items-center gap-3 px-3 font-mono text-3xs"
            >
              <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
              {item.detail === null ? null : (
                <span className="max-w-[52%] shrink-0 truncate text-muted-foreground">
                  {item.detail}
                </span>
              )}
            </div>
          ))}
          {presentation.expandable ? (
            <button
              type="button"
              // oxlint-disable-next-line shadcn/no-unknown-classes -- React Flow's drag and pan opt-outs, read by the library rather than styled
              className="nodrag nopan flex h-[1.8125rem] w-full items-center justify-between bg-muted/25 px-3 text-3xs text-muted-foreground outline-none hover:bg-muted/55 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? `Show fewer members in ${declaration.name}`
                  : `Show ${presentation.hiddenItemCount} more members in ${declaration.name}`
              }
              onClick={(event) => {
                event.stopPropagation();
                if (event.detail > 1) return;
                onToggleExpanded(declaration.id);
              }}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <span>{expanded ? "Show less" : `+${presentation.hiddenItemCount} more`}</span>
              {expanded ? (
                <ChevronUp aria-hidden className="size-3" />
              ) : (
                <ChevronDown aria-hidden className="size-3" />
              )}
            </button>
          ) : null}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="size-2! border-card! bg-primary!"
      />
    </div>
  );
}

const NODE_TYPES = { schemaDeclaration: SchemaDeclarationCard };

/** React Flow's theme variables, pointed at the app's code surface so the canvas follows the theme. */
const REACT_FLOW_THEME = {
  "--xy-background-color": "var(--code-background)",
  "--xy-background-pattern-color": "color-mix(in srgb, var(--border) 72%, transparent)",
  "--xy-edge-stroke": "var(--muted-foreground)",
  "--xy-handle-background-color": "var(--primary)",
  "--xy-handle-border-color": "var(--card)",
} as CSSProperties;

function relationLabel(relation: GraphqlSchemaRelation): string {
  const labels = relation.labels.join(", ");
  return relation.omittedLabelCount === 0 ? labels : `${labels} +${relation.omittedLabelCount}`;
}

function countedNoun(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function layoutDiagram(
  declarations: ReadonlyArray<GraphqlSchemaDeclaration>,
  relations: ReadonlyArray<GraphqlSchemaRelation>,
  expandedDeclarations: ReadonlySet<string>,
  onToggleExpanded: (declarationId: string) => void,
): { readonly nodes: Array<SchemaDeclarationNode>; readonly edges: Array<Edge> } {
  const graph = new Graph()
    .setDefaultEdgeLabel(() => ({}))
    .setGraph({
      rankdir: "LR",
      ranksep: 112,
      nodesep: 48,
      edgesep: 22,
      marginx: 32,
      marginy: 32,
      ranker: "network-simplex",
    });

  const presentations = new Map<string, GraphqlSchemaDeclarationPresentation>();
  for (const declaration of declarations) {
    const presentation = presentGraphqlSchemaDeclaration(
      declaration,
      expandedDeclarations.has(declaration.id),
    );
    presentations.set(declaration.id, presentation);
    graph.setNode(declaration.id, {
      width: NODE_WIDTH,
      height: declarationHeight(presentation),
    });
  }
  for (const relation of relations) graph.setEdge(relation.source, relation.target);
  layout(graph);

  return {
    nodes: declarations.map((declaration) => {
      const position = graph.node(declaration.id);
      const presentation = presentations.get(declaration.id)!;
      const height = declarationHeight(presentation);
      return {
        id: declaration.id,
        type: "schemaDeclaration",
        position: {
          x: (position?.x ?? 0) - NODE_WIDTH / 2,
          y: (position?.y ?? 0) - height / 2,
        },
        data: {
          declaration,
          presentation,
          expanded: expandedDeclarations.has(declaration.id),
          onToggleExpanded,
        },
        width: NODE_WIDTH,
        height,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        selectable: false,
        focusable: true,
        ariaLabel: `${DECLARATION_LABELS[declaration.kind]} ${declaration.name}`,
      };
    }),
    edges: relations.map((relation) => ({
      id: relation.id,
      source: relation.source,
      target: relation.target,
      type: relation.source === relation.target ? "default" : "smoothstep",
      label: relationLabel(relation),
      selectable: false,
      focusable: false,
      interactionWidth: 12,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 13,
        height: 13,
        color: "var(--muted-foreground)",
      },
      style: {
        stroke: "var(--muted-foreground)",
        strokeOpacity: 0.58,
        strokeWidth: 1.15,
      },
      labelStyle: {
        fill: "var(--muted-foreground)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
      },
      labelBgStyle: {
        fill: "var(--code-background)",
        fillOpacity: 0.94,
      },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 3,
    })),
  };
}

/** Let export mode mount normally virtualized nodes before the DOM capture starts. */
function waitForDiagramPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function DiagramControls({
  nodes,
  rootRef,
  filename,
  exporting,
  onExportingChange,
}: {
  nodes: ReadonlyArray<SchemaDeclarationNode>;
  rootRef: RefObject<HTMLDivElement | null>;
  filename: string;
  exporting: boolean;
  onExportingChange: (exporting: boolean) => void;
}) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const imageActionInFlightRef = useRef(false);
  const capturePng = useCallback(async () => {
    await waitForDiagramPaint();
    const root = rootRef.current;
    const viewportElement = root?.querySelector<HTMLElement>(".react-flow__viewport");
    if (root === null || viewportElement === null || viewportElement === undefined) {
      throw new Error("The diagram canvas is not available.");
    }
    return renderSchemaDiagramPng({
      viewportElement,
      bounds: getNodesBounds([...nodes]),
      backgroundColor: getComputedStyle(root).backgroundColor,
    });
  }, [nodes, rootRef]);
  const handleImageAction = useCallback(
    (action: "copy" | "download") => {
      if (imageActionInFlightRef.current) return;
      imageActionInFlightRef.current = true;
      onExportingChange(true);

      const operation =
        action === "copy"
          ? copySchemaDiagramPng(capturePng)
          : downloadSchemaDiagramPng({ image: capturePng(), filename });

      void operation
        .then(() => {
          if (action !== "copy") return;
          toastManager.add({
            type: "success",
            title: "Diagram copied",
            description: "Paste it into the composer or another app.",
          });
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: action === "copy" ? "Could not copy diagram" : "Could not download diagram",
            description: error instanceof Error ? error.message : "PNG generation failed.",
          });
        })
        .finally(() => {
          imageActionInFlightRef.current = false;
          onExportingChange(false);
        });
    },
    [capturePng, filename, onExportingChange],
  );

  return (
    <Panel position="bottom-left" className="m-2!">
      {/* oxlint-disable-next-line shadcn/no-unknown-classes -- React Flow's drag and pan opt-outs, read by the library rather than styled */}
      <div className="nodrag nopan flex items-center gap-0.5 rounded-lg border border-border/70 bg-popover/95 p-0.5 shadow-sm">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Zoom out"
                onClick={() => void zoomOut()}
              />
            }
          >
            <Minus aria-hidden />
          </TooltipTrigger>
          <TooltipPopup side="top">Zoom out</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Zoom in"
                onClick={() => void zoomIn()}
              />
            }
          >
            <Plus aria-hidden />
          </TooltipTrigger>
          <TooltipPopup side="top">Zoom in</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Fit diagram"
                onClick={() => void fitView({ padding: 0.16, maxZoom: 1 })}
              />
            }
          >
            <Maximize2 aria-hidden />
          </TooltipTrigger>
          <TooltipPopup side="top">Fit diagram</TooltipPopup>
        </Tooltip>
        <span aria-hidden className="mx-0.5 h-3.5 w-px bg-border/70" />
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={exporting ? "Preparing diagram PNG" : "Diagram image options"}
                      disabled={exporting}
                    />
                  }
                />
              }
            >
              {exporting ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : (
                <Download aria-hidden />
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">{exporting ? "Preparing PNG" : "Diagram image"}</TooltipPopup>
          </Tooltip>
          <MenuPopup side="top" align="start">
            <MenuItem onClick={() => handleImageAction("download")}>
              <Download aria-hidden />
              Download PNG
            </MenuItem>
            <MenuItem onClick={() => handleImageAction("copy")}>
              <Copy aria-hidden />
              Copy PNG
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </Panel>
  );
}

function DiagramState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-[clamp(24rem,62vh,44rem)] items-center justify-center bg-code px-6 py-10 text-center">
      <div className="max-w-sm space-y-1">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function SchemaDiagram({ source, label }: { source: string; label: string }) {
  const { resolvedTheme } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [expansion, setExpansion] = useState<{
    readonly source: string;
    readonly declarations: ReadonlySet<string>;
  }>(() => ({ source, declarations: EMPTY_EXPANDED_DECLARATIONS }));
  const expandedDeclarations =
    expansion.source === source ? expansion.declarations : EMPTY_EXPANDED_DECLARATIONS;
  const toggleExpanded = useCallback(
    (declarationId: string) => {
      setExpansion((current) => {
        const declarations = new Set(
          current.source === source ? current.declarations : EMPTY_EXPANDED_DECLARATIONS,
        );
        if (declarations.has(declarationId)) declarations.delete(declarationId);
        else declarations.add(declarationId);
        return { source, declarations };
      });
    },
    [source],
  );
  const handleNodeDoubleClick = useCallback<NodeMouseHandler<SchemaDeclarationNode>>(
    (_event, node) => {
      if (!node.data.presentation.expandable) return;
      toggleExpanded(node.id);
    },
    [toggleExpanded],
  );
  const parsed = useMemo(() => parseGraphqlSchemaDiagram(source), [source]);
  const diagram = useMemo(
    () =>
      parsed.ok
        ? layoutDiagram(
            parsed.model.declarations,
            parsed.model.relations,
            expandedDeclarations,
            toggleExpanded,
          )
        : null,
    [expandedDeclarations, parsed, toggleExpanded],
  );

  if (!parsed.ok) {
    return <DiagramState title="Diagram unavailable" detail={parsed.message} />;
  }
  if (diagram === null || diagram.nodes.length === 0) {
    return (
      <DiagramState
        title="No declarations to diagram"
        detail="This SDL contains no object, input, interface, enum, union, or scalar declarations."
      />
    );
  }

  const collapsedDeclarationCount = parsed.model.declarations.filter(
    (declaration) =>
      declaration.items.length > GRAPHQL_SCHEMA_DIAGRAM_LIMITS.itemsPerDeclaration &&
      !expandedDeclarations.has(declaration.id),
  ).length;
  const hasLimits =
    parsed.model.omittedDeclarationCount > 0 ||
    parsed.model.omittedRelationCount > 0 ||
    collapsedDeclarationCount > 0;
  const limitMessages = [
    parsed.model.omittedDeclarationCount > 0
      ? `${countedNoun(parsed.model.omittedDeclarationCount, "declaration")} omitted`
      : null,
    parsed.model.omittedRelationCount > 0
      ? `${countedNoun(parsed.model.omittedRelationCount, "relation")} omitted`
      : null,
    collapsedDeclarationCount > 0
      ? `${countedNoun(collapsedDeclarationCount, "declaration")} collapsed`
      : null,
  ].filter((message): message is string => message !== null);

  return (
    <div
      ref={rootRef}
      className="min-w-0 bg-code text-code-foreground"
      role="region"
      aria-label="GraphQL schema relationship diagram"
    >
      <div className="h-[clamp(24rem,62vh,44rem)] w-full">
        <ReactFlow<SchemaDeclarationNode, Edge>
          nodes={diagram.nodes}
          edges={diagram.edges}
          nodeTypes={NODE_TYPES}
          colorMode={resolvedTheme}
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
          minZoom={0.08}
          maxZoom={2}
          nodesConnectable={false}
          nodesDraggable={false}
          edgesReconnectable={false}
          elementsSelectable={false}
          onNodeClick={enableSchemaNodePointerEvents}
          onNodeDoubleClick={handleNodeDoubleClick}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          panOnScroll={false}
          onlyRenderVisibleElements={!exporting}
          proOptions={{ hideAttribution: true }}
          style={REACT_FLOW_THEME}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Panel position="top-right" className="m-2!">
            <span className="pointer-events-none rounded-md border border-border/70 bg-popover/92 px-2 py-1 font-mono text-3xs text-muted-foreground shadow-xs">
              {diagram.nodes.length} declaration{diagram.nodes.length === 1 ? "" : "s"},{" "}
              {diagram.edges.length} relation{diagram.edges.length === 1 ? "" : "s"}
            </span>
          </Panel>
          <DiagramControls
            nodes={diagram.nodes}
            rootRef={rootRef}
            filename={schemaDiagramPngFilename(label)}
            exporting={exporting}
            onExportingChange={setExporting}
          />
        </ReactFlow>
      </div>
      {hasLimits ? (
        <p className="border-t border-border/60 px-3 py-2 text-3xs leading-relaxed text-muted-foreground">
          Diagram simplified for performance: {limitMessages.join(", ")}.
          {collapsedDeclarationCount > 0 ? " Select a +N more row to expand it." : null}
        </p>
      ) : null}
    </div>
  );
}
