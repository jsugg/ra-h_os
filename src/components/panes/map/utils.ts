import type { Node as DbNode, Edge as DbEdge } from '@/types/database';
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';

// Fixed palette for dimension border colors (muted, dark-theme-friendly)
const DIMENSION_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
];

function hashDimensionColor(dimension: string): string {
  let hash = 0;
  for (let i = 0; i < dimension.length; i++) {
    hash = ((hash << 5) - hash + dimension.charCodeAt(i)) | 0;
  }
  return DIMENSION_COLORS[Math.abs(hash) % DIMENSION_COLORS.length];
}

export function getDimensionColor(dimensions: string[] | undefined): string | undefined {
  if (!dimensions || dimensions.length === 0) return undefined;
  // Use first dimension for border color
  return hashDimensionColor(dimensions[0]);
}

export interface RahNodeData {
  label: string;
  dimensions: string[];
  edgeCount: number;
  isExpanded: boolean;
  dbNode: DbNode;
  dimensionIcons?: Record<string, string>;
  primaryDimensionColor?: string;
  [key: string]: unknown;
}

type MapPosition = { x?: number; y?: number };

function getMetadataRecord(node: DbNode): Record<string, unknown> | null {
  if (typeof node.metadata === 'string') {
    return safeParseJSON(node.metadata);
  }
  if (node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)) {
    return node.metadata;
  }
  return null;
}

function getSavedMapPosition(node: DbNode): MapPosition | null {
  const metadata = getMetadataRecord(node);
  const rawPosition = metadata?.map_position;
  if (!rawPosition || typeof rawPosition !== 'object' || Array.isArray(rawPosition)) {
    return null;
  }
  return rawPosition as MapPosition;
}

function getEdgeExplanation(edge: DbEdge): string {
  if (edge.context && typeof edge.context === 'object' && !Array.isArray(edge.context)) {
    return typeof edge.context.explanation === 'string' ? edge.context.explanation : '';
  }
  return '';
}

const NODE_LIMIT = 200;
const LABEL_THRESHOLD = 15;

export { NODE_LIMIT, LABEL_THRESHOLD };

/**
 * Get node position from saved metadata or calculate using Fibonacci spiral.
 */
export function getNodePosition(
  node: DbNode,
  index: number,
  total: number,
  centerX: number,
  centerY: number,
  maxEdges: number,
): { x: number; y: number } {
  // Check for saved position in metadata
  const savedPos = getSavedMapPosition(node);
  if (savedPos?.x !== undefined && savedPos?.y !== undefined) {
    return { x: savedPos.x, y: savedPos.y };
  }

  // Fibonacci spiral layout
  const edgeCount = node.edge_count ?? 0;
  const edgeRatio = maxEdges > 0 ? edgeCount / maxEdges : 0;

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = index * goldenAngle;

  const isLabeled = index < LABEL_THRESHOLD;
  const labelSpacing = isLabeled ? 60 : 0;
  const containerSize = Math.min(centerX * 2, centerY * 2);
  const baseDistance = 80 + labelSpacing + (1 - edgeRatio) * containerSize * 0.35;
  const distance = baseDistance + index * 4;

  return {
    x: centerX + Math.cos(angle) * distance,
    y: centerY + Math.sin(angle) * distance,
  };
}

/**
 * Position expanded (traversal) nodes in a circle around a reference node.
 */
export function getExpandedNodePosition(
  index: number,
  total: number,
  refX: number,
  refY: number,
): { x: number; y: number } {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  const distance = 150 + (index % 3) * 40;
  return {
    x: refX + Math.cos(angle) * distance,
    y: refY + Math.sin(angle) * distance,
  };
}

/**
 * Transform DB nodes into React Flow nodes.
 * When a node is selected, non-connected nodes get dimmed via className.
 */
export function toRFNodes(
  baseNodes: DbNode[],
  expandedNodes: DbNode[],
  centerX: number,
  centerY: number,
  selectedNodeId: number | null,
  connectedNodeIds: Set<number>,
  existingPositions: Map<string, { x: number; y: number }>,
  dimensionIcons?: Record<string, string>,
): RFNode<RahNodeData>[] {
  const sortedBase = [...baseNodes].sort((a, b) => (b.edge_count ?? 0) - (a.edge_count ?? 0));
  const maxEdges = Math.max(...sortedBase.map(n => n.edge_count ?? 0), 1);
  const baseNodeIds = new Set(baseNodes.map(n => n.id));
  const hasSelection = selectedNodeId !== null;

  const rfNodes: RFNode<RahNodeData>[] = sortedBase.map((node, index) => {
    const id = String(node.id);
    // Prefer React Flow's current position (for drag state), then saved, then calculated
    const existingPos = existingPositions.get(id);
    const pos = existingPos || getNodePosition(node, index, sortedBase.length, centerX, centerY, maxEdges);

    // Dim nodes that aren't selected or connected to selection
    const isDimmed = hasSelection && node.id !== selectedNodeId && !connectedNodeIds.has(node.id);

    return {
      id,
      type: 'rahNode',
      position: pos,
      className: isDimmed ? 'dimmed' : undefined,
      data: {
        label: node.title || 'Untitled',
        dimensions: node.dimensions || [],
        edgeCount: node.edge_count ?? 0,
        isExpanded: false,
        dbNode: node,
        dimensionIcons,
        primaryDimensionColor: getDimensionColor(node.dimensions),
      },
    };
  });

  // Add expanded nodes not already in base
  const uniqueExpanded = expandedNodes.filter(n => !baseNodeIds.has(n.id));

  // Find reference position for expanded nodes (the selected node)
  let refX = centerX;
  let refY = centerY;
  if (selectedNodeId) {
    const selectedRF = rfNodes.find(n => n.id === String(selectedNodeId));
    if (selectedRF) {
      refX = selectedRF.position.x;
      refY = selectedRF.position.y;
    }
  }

  uniqueExpanded.forEach((node, index) => {
    const id = String(node.id);
    const existingPos = existingPositions.get(id);

    // Check for saved metadata position
    const savedPos = getSavedMapPosition(node);

    const pos = existingPos
      || (savedPos?.x !== undefined && savedPos?.y !== undefined ? { x: savedPos.x, y: savedPos.y } : null)
      || getExpandedNodePosition(index, uniqueExpanded.length, refX, refY);

    const isDimmed = hasSelection && node.id !== selectedNodeId && !connectedNodeIds.has(node.id);

    rfNodes.push({
      id,
      type: 'rahNode',
      position: pos,
      className: isDimmed ? 'dimmed' : undefined,
      data: {
        label: node.title || 'Untitled',
        dimensions: node.dimensions || [],
        edgeCount: node.edge_count ?? 0,
        isExpanded: true,
        dbNode: node,
        dimensionIcons,
        primaryDimensionColor: getDimensionColor(node.dimensions),
      },
    });
  });

  return rfNodes;
}

/**
 * Transform DB edges into React Flow edges, filtering to only those
 * connecting nodes currently in the graph.
 * When a node is selected, connected edges are highlighted and others dimmed.
 */
export function toRFEdges(
  dbEdges: DbEdge[],
  nodeIds: Set<string>,
  selectedNodeId: number | null,
): RFEdge[] {
  const hasSelection = selectedNodeId !== null;

  return dbEdges
    .filter(e => nodeIds.has(String(e.from_node_id)) && nodeIds.has(String(e.to_node_id)))
    .map(e => {
      const isConnected = hasSelection && (
        e.from_node_id === selectedNodeId || e.to_node_id === selectedNodeId
      );
      const isDimmed = hasSelection && !isConnected;

      const explanation = getEdgeExplanation(e);

      return {
        id: String(e.id),
        source: String(e.from_node_id),
        target: String(e.to_node_id),
        type: 'rahEdge',
        animated: isConnected,
        data: { explanation },
        style: isConnected
          ? { stroke: '#22c55e', strokeWidth: 2.5, opacity: 1 }
          : isDimmed
            ? { stroke: '#374151', strokeWidth: 1, opacity: 0.15 }
            : undefined,
        zIndex: isConnected ? 10 : 0,
      };
    });
}

function safeParseJSON(str: string | null | undefined): Record<string, unknown> | null {
  if (!str || str === 'null') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
