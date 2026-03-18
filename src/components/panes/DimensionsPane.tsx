"use client";

import FolderViewOverlay from '@/components/nodes/FolderViewOverlay';
import PaneHeader from './PaneHeader';
import { DimensionsPaneProps } from './types';

export default function DimensionsPane({
  slot,
  isActive: _isActive,
  onPaneAction,
  onCollapse,
  onSwapPanes,
  onNodeOpen,
  refreshToken,
  onDataChanged,
  onDimensionSelect,
}: DimensionsPaneProps) {
  // When used as a pane, "close" means switch back to node view
  const handleClose = () => {
    onPaneAction?.({ type: 'switch-pane-type', paneType: 'node' });
  };

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'transparent',
      overflow: 'hidden',
    }}>
      <PaneHeader slot={slot} onCollapse={onCollapse} onSwapPanes={onSwapPanes} />

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {/* FolderViewOverlay expects to be an overlay, so we wrap it in a container */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'transparent',
        }}>
          <FolderViewOverlay
            onClose={handleClose}
            onNodeOpen={onNodeOpen}
            refreshToken={refreshToken}
            onDataChanged={onDataChanged}
            onDimensionSelect={onDimensionSelect}
          />
        </div>
      </div>
    </div>
  );
}
