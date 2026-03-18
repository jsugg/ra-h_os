"use client";

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { RahNodeData } from './utils';
import { getNodeIcon } from '@/utils/nodeIcons';

type RahNodeType = Node<RahNodeData, 'rahNode'>;

function RahNodeComponent({ data, selected }: NodeProps<RahNodeType>) {
  const { label, dimensions, edgeCount, isExpanded, dbNode, dimensionIcons, primaryDimensionColor } = data;
  const isTop = !isExpanded && edgeCount > 3;

  return (
    <div
      className={[
        'rah-map-node',
        isExpanded && 'rah-map-node--expanded',
        isTop && 'rah-map-node--top',
        selected && 'rah-map-node--selected',
      ].filter(Boolean).join(' ')}
      style={primaryDimensionColor ? { borderLeftColor: primaryDimensionColor, borderLeftWidth: 3 } : undefined}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="rah-map-handle"
      />
      <div className="rah-map-node__title">
        <span className="rah-map-node__icon">
          {getNodeIcon(dbNode, dimensionIcons, 14)}
        </span>
        {label.length > 26 ? label.slice(0, 24) + '\u2026' : label}
      </div>
      {(isTop || isExpanded) && dimensions.length > 0 && (
        <div className="rah-map-node__dims">
          {dimensions.slice(0, 3).map(d => d.length > 12 ? d.slice(0, 11) + '\u2026' : d).join(' \u00b7 ')}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="rah-map-handle"
      />
    </div>
  );
}

export const RahNode = memo(RahNodeComponent);
