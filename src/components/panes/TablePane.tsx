"use client";

import PaneHeader from './PaneHeader';
import DatabaseTableView from '../views/DatabaseTableView';
import type { BasePaneProps } from './types';

export interface TablePaneProps extends BasePaneProps {
  onNodeClick: (nodeId: number) => void;
  refreshToken?: number;
}

export default function TablePane({
  slot,
  isActive: _isActive,
  onPaneAction: _onPaneAction,
  onCollapse,
  onSwapPanes,
  tabBar,
  onNodeClick,
  refreshToken
}: TablePaneProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'transparent',
      overflow: 'hidden'
    }}>
      <PaneHeader slot={slot} onCollapse={onCollapse} onSwapPanes={onSwapPanes} tabBar={tabBar} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DatabaseTableView
          onNodeClick={onNodeClick}
          refreshToken={refreshToken}
        />
      </div>
    </div>
  );
}
