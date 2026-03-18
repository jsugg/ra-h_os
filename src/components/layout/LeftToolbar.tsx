"use client";

import { useState } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  LayoutList,
  Map,
  Folder,
  Table2,
  BookOpen,
  Settings,
} from 'lucide-react';
import type { PaneType } from '../panes/types';

interface LeftToolbarProps {
  onSearchClick: () => void;
  onAddStuffClick: () => void;
  onRefreshClick: () => void;
  onSettingsClick: () => void;
  onPaneTypeClick: (paneType: PaneType) => void;
  activePane: 'A' | 'B';
  slotAType: PaneType | null;
  slotBType: PaneType | null;
}

// Map pane types to their icons (chat removed in rah-light, guides moved to settings)
const PANE_TYPE_ICONS: Record<string, typeof LayoutList> = {
  views: LayoutList,
  map: Map,
  dimensions: Folder,
  table: Table2,
  skills: BookOpen,
};

const PANE_TYPE_LABELS: Record<string, string> = {
  views: 'Feed',
  map: 'Map',
  dimensions: 'Dimensions',
  table: 'Table',
  skills: 'Skills',
};

// Pane types shown in the toolbar center section (skills is pinned above settings)
const TOOLBAR_PANE_TYPES: PaneType[] = ['views', 'map', 'dimensions', 'table'];

interface ToolbarButtonProps {
  icon: typeof Search;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  isActive?: boolean;
}

function ToolbarButton({ icon: Icon, label, shortcut, onClick, disabled, isActive }: ToolbarButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={shortcut ? `${label} (${shortcut})` : label}
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '8px',
        border: 'none',
        background: isHovered ? '#1a1a1a' : 'transparent',
        color: isActive ? '#22c55e' : (isHovered ? '#aaa' : '#666'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s ease',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={18} />
    </button>
  );
}

interface PaneTypeButtonProps {
  icon: typeof LayoutList;
  label: string;
  paneType: PaneType;
  isOpen: boolean;
  isActivePane: boolean;
  onClick: () => void;
}

function PaneTypeButton({ icon: Icon, label, paneType: _paneType, isOpen, isActivePane, onClick }: PaneTypeButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Determine color: green if open, brighter if it's the active pane
  const getColor = () => {
    if (isOpen) {
      return isActivePane ? '#4ade80' : '#22c55e'; // Brighter green for active
    }
    return isHovered ? '#aaa' : '#666';
  };

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={label}
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '8px',
        border: 'none',
        background: isOpen ? '#1a1a1a' : (isHovered ? '#151515' : 'transparent'),
        color: getColor(),
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s ease',
        position: 'relative',
      }}
    >
      <Icon size={18} />
      {/* Active pane indicator dot */}
      {isActivePane && isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: '4px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '4px',
            height: '4px',
            borderRadius: '50%',
            background: '#4ade80',
          }}
        />
      )}
    </button>
  );
}

export default function LeftToolbar({
  onSearchClick,
  onAddStuffClick,
  onRefreshClick,
  onSettingsClick,
  onPaneTypeClick,
  activePane,
  slotAType,
  slotBType,
}: LeftToolbarProps) {
  // Determine which pane types are currently open
  const openPaneTypes = new Set<PaneType>(
    [slotAType, slotBType].filter((t): t is PaneType => t !== null)
  );

  // Determine which pane type is in the active pane (null if pane is closed)
  const activePaneType = activePane === 'A' ? slotAType : slotBType;

  return (
    <div
      style={{
        width: '50px',
        height: '100%',
        background: '#0a0a0a',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '12px 0',
        flexShrink: 0,
      }}
    >
      {/* Top section - Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <ToolbarButton
          icon={Search}
          label="Search"
          shortcut="⌘K"
          onClick={onSearchClick}
        />
        <ToolbarButton
          icon={Plus}
          label="Add Stuff"
          onClick={onAddStuffClick}
        />
        <ToolbarButton
          icon={RefreshCw}
          label="Refresh"
          shortcut="⌘⇧R"
          onClick={onRefreshClick}
        />
      </div>

      {/* Middle section - Pane Types */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          padding: '8px 0',
        }}
      >
        {TOOLBAR_PANE_TYPES.map((paneType) => {
          const Icon = PANE_TYPE_ICONS[paneType];
          const label = PANE_TYPE_LABELS[paneType];
          const isOpen = openPaneTypes.has(paneType);
          const isActivePane = activePaneType === paneType;

          return (
            <PaneTypeButton
              key={paneType}
              icon={Icon}
              label={label}
              paneType={paneType}
              isOpen={isOpen}
              isActivePane={isActivePane}
              onClick={() => onPaneTypeClick(paneType)}
            />
          );
        })}
      </div>

      {/* Bottom section - Skills + Settings */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <PaneTypeButton
          icon={BookOpen}
          label="Skills"
          paneType="skills"
          isOpen={openPaneTypes.has('skills')}
          isActivePane={activePaneType === 'skills'}
          onClick={() => onPaneTypeClick('skills')}
        />
        <ToolbarButton
          icon={Settings}
          label="Settings"
          onClick={onSettingsClick}
        />
      </div>
    </div>
  );
}
