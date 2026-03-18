"use client";

import PaneHeader from './PaneHeader';
import ViewsOverlay from '../views/ViewsOverlay';
import type { BasePaneProps } from './types';
import type { PendingNode } from '../layout/ThreePanelLayout';

export interface ViewsPaneProps extends BasePaneProps {
  onNodeClick: (nodeId: number) => void;
  onNodeOpenInOtherPane?: (nodeId: number) => void;
  refreshToken?: number;
  pendingNodes?: PendingNode[];
  onDismissPending?: (id: string) => void;
}

export default function ViewsPane({
  slot,
  isActive: _isActive,
  onPaneAction: _onPaneAction,
  onCollapse,
  onSwapPanes,
  onNodeClick,
  onNodeOpenInOtherPane,
  refreshToken,
  pendingNodes,
  onDismissPending,
}: ViewsPaneProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'transparent',
      overflow: 'hidden'
    }}>
      <PaneHeader slot={slot} onCollapse={onCollapse} onSwapPanes={onSwapPanes} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ViewsOverlay
          onNodeClick={onNodeClick}
          onNodeOpenInOtherPane={onNodeOpenInOtherPane}
          refreshToken={refreshToken}
          pendingNodes={pendingNodes}
          onDismissPending={onDismissPending}
        />
      </div>
    </div>
  );
}
