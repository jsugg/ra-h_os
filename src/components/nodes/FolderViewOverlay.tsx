"use client";

import { useEffect, useMemo, useState, useRef, type DragEvent } from 'react';
import { Check, X, ArrowLeft, Plus, Trash2, Edit2, Lock } from 'lucide-react';
import type { Node } from '@/types/database';
import ConfirmDialog from '../common/ConfirmDialog';
import InputDialog from '../common/InputDialog';
import { getNodeIcon } from '@/utils/nodeIcons';
import LucideIconPicker, { DynamicIcon } from '../common/LucideIconPicker';
import { useDimensionIcons } from '@/context/DimensionIconsContext';
import { usePersistentState } from '@/hooks/usePersistentState';

interface DimensionSummary {
  dimension: string;
  count: number;
  isPriority: boolean;
  description?: string | null;
}

interface FolderViewOverlayProps {
  onClose: () => void;
  onNodeOpen: (nodeId: number) => void;
  refreshToken: number;
  onDataChanged?: () => void;
  onDimensionSelect?: (dimensionName: string | null) => void;
}

const PAGE_SIZE = 100;

export default function FolderViewOverlay({ onClose, onNodeOpen, refreshToken, onDataChanged, onDimensionSelect: _onDimensionSelect }: FolderViewOverlayProps) {
  const [view, setView] = useState<'dimensions' | 'nodes'>('dimensions');
  const [dimensions, setDimensions] = useState<DimensionSummary[]>([]);
  const [dimensionsLoading, setDimensionsLoading] = useState(true);
  const [dimensionsError, setDimensionsError] = useState<string | null>(null);
  const [selectedDimension, setSelectedDimension] = useState<DimensionSummary | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [hasMoreNodes, setHasMoreNodes] = useState(false);
  const [nodeOffset, setNodeOffset] = useState(0);
  const [deletingDimension, setDeletingDimension] = useState<string | null>(null);
  const [dimensionPendingDelete, setDimensionPendingDelete] = useState<string | null>(null);
  const [dragHoverDimension, setDragHoverDimension] = useState<string | null>(null);
  const [_editingDescription, setEditingDescription] = useState<boolean>(false);
  const [editDescriptionText, setEditDescriptionText] = useState('');
  const [_editingDimensionName, setEditingDimensionName] = useState<boolean>(false);
  const [editDimensionNameText, setEditDimensionNameText] = useState('');
  const [showAddDimensionDialog, setShowAddDimensionDialog] = useState(false);
  const draggedNodeRef = useRef<{ id: number; title?: string; dimensions?: string[] } | null>(null);

  // Kanban columns state (global, persisted)
  const [kanbanColumns, setKanbanColumns] = usePersistentState<{ dimension: string; order: number }[]>(
    'ui.kanbanColumns.global',
    []
  );

  // Kanban-specific drag states
  const [draggedNodeId, setDraggedNodeId] = useState<number | null>(null);
  const [draggedFromColumn, setDraggedFromColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [showKanbanColumnPicker, setShowKanbanColumnPicker] = useState(false);
  const [kanbanSearchQuery, setKanbanSearchQuery] = useState('');

  // Kanban drag-and-drop state
  const [_draggedNode, _setDraggedNode] = useState<{ id: number; fromDimension: string } | null>(null);
  const [_dropTargetDimension, _setDropTargetDimension] = useState<string | null>(null);

  // Kanban column reordering state
  const [_draggedColumn, _setDraggedColumn] = useState<string | null>(null);
  const [_columnDropTarget, _setColumnDropTarget] = useState<string | null>(null);

  // Node priority ordering within dimensions (persisted)
  const [dimensionOrders, setDimensionOrders] = usePersistentState<Record<string, number[]>>('ui.dimensionOrders', {});

  // Dimension icons from shared context
  const { dimensionIcons, setDimensionIcons } = useDimensionIcons();

  // Dimension edit modal state
  const [editingDimensionModal, setEditingDimensionModal] = useState<DimensionSummary | null>(null);
  const [editModalName, setEditModalName] = useState('');
  const [editModalDescription, setEditModalDescription] = useState('');
  const [editModalIcon, setEditModalIcon] = useState('Folder');
  const [savingDimensionEdit, setSavingDimensionEdit] = useState(false);
  const [_editModalNameError, setEditModalNameError] = useState('');

  // Within-dimension reorder drag state
  const [_reorderDrag, setReorderDrag] = useState<{ nodeId: number; dimension: string; index: number } | null>(null);
  const [_reorderDropIndex, setReorderDropIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchDimensions();
  }, []);

  useEffect(() => {
    if (view === 'dimensions') {
      fetchDimensions();
    } else if (selectedDimension) {
      fetchNodes(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    if (!selectedDimension) return;
    fetchNodes(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDimension?.dimension]);

  // Sort nodes by their priority order within a dimension
  const _sortNodesByDimensionOrder = (nodes: Node[], dimension: string): Node[] => {
    const order = dimensionOrders[dimension] || [];
    return [...nodes].sort((a, b) => {
      const aIndex = order.indexOf(a.id);
      const bIndex = order.indexOf(b.id);
      // Nodes in order array come first, sorted by their position
      // Nodes not in order array go to end, sorted by ID
      if (aIndex === -1 && bIndex === -1) return a.id - b.id;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  };

  // Handle reordering a node within a dimension
  const _handleReorderDrop = (dimension: string, fromIndex: number, toIndex: number, nodes: Node[]) => {
    if (fromIndex === toIndex) return;

    // Get current order or create from current node order
    const currentOrder = dimensionOrders[dimension] || nodes.map(n => n.id);
    const nodeIds = [...currentOrder];

    // Ensure all nodes are in the order array
    nodes.forEach(n => {
      if (!nodeIds.includes(n.id)) {
        nodeIds.push(n.id);
      }
    });

    // Move the node from fromIndex to toIndex
    const [movedId] = nodeIds.splice(fromIndex, 1);
    nodeIds.splice(toIndex, 0, movedId);

    // Update the dimension orders
    setDimensionOrders({
      ...dimensionOrders,
      [dimension]: nodeIds
    });

    setReorderDrag(null);
    setReorderDropIndex(null);
  };

  const sortedDimensions = useMemo(() => {
    return [...dimensions].sort((a, b) => {
      if (a.isPriority !== b.isPriority) {
        return a.isPriority ? -1 : 1;
      }
      return a.dimension.localeCompare(b.dimension);
    });
  }, [dimensions]);

  const fetchDimensions = async () => {
    setDimensionsLoading(true);
    setDimensionsError(null);
    try {
      const response = await fetch('/api/dimensions/popular');
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch dimensions');
      }
      setDimensions(data.data || []);
    } catch (error) {
      console.error('Error fetching dimensions:', error);
      setDimensionsError('Failed to load dimensions');
    } finally {
      setDimensionsLoading(false);
    }
  };

  const fetchNodes = async (reset = false) => {
    if (!selectedDimension) return;
    setNodesLoading(true);
    setNodesError(null);
    try {
      const offset = reset ? 0 : nodeOffset;
      const response = await fetch(`/api/nodes?dimensions=${encodeURIComponent(selectedDimension.dimension)}&limit=${PAGE_SIZE}&offset=${offset}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch nodes');
      }
      const fetchedNodes: Node[] = data.data || [];
      setNodes((prev) => reset ? fetchedNodes : [...prev, ...fetchedNodes]);
      setHasMoreNodes(fetchedNodes.length === PAGE_SIZE);
      setNodeOffset(offset + fetchedNodes.length);
    } catch (error) {
      console.error('Error fetching nodes:', error);
      setNodesError('Failed to load nodes');
    } finally {
      setNodesLoading(false);
    }
  };

  const handleSelectDimension = (dimension: DimensionSummary) => {
    setSelectedDimension(dimension);
    setNodes([]);
    setNodeOffset(0);
    setHasMoreNodes(false);
    setView('nodes');
  };

  const handleBackToDimensions = () => {
    setView('dimensions');
    setSelectedDimension(null);
    setNodes([]);
    setNodeOffset(0);
    setHasMoreNodes(false);
  };

  const handleAddDimension = async (name: string) => {
    if (!name || !name.trim()) return;
    try {
      const response = await fetch('/api/dimensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to create dimension');
      }
      await fetchDimensions();
      onDataChanged?.();
      setShowAddDimensionDialog(false);
    } catch (error) {
      console.error('Error adding dimension:', error);
      alert('Failed to create dimension. Please try again.');
    }
  };

  const handleToggleLock = async (dimension: string) => {
    try {
      const response = await fetch('/api/dimensions/popular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dimension })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to toggle dimension');
      }
      await fetchDimensions();
      onDataChanged?.();
    } catch (error) {
      console.error('Error toggling lock:', error);
      alert('Failed to update lock state.');
    }
  };

  const handleDeleteDimension = async (dimension: string) => {
    setDeletingDimension(dimension);
    try {
      const response = await fetch(`/api/dimensions?name=${encodeURIComponent(dimension)}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete dimension');
      }
      if (selectedDimension?.dimension === dimension) {
        handleBackToDimensions();
      }
      await fetchDimensions();
      onDataChanged?.();
    } catch (error) {
      console.error('Error deleting dimension:', error);
      alert('Failed to delete dimension. Please try again.');
    } finally {
      setDeletingDimension((current) => (current === dimension ? null : current));
      setDimensionPendingDelete((current) => (current === dimension ? null : current));
    }
  };

  const handleNodeTileDragStart = (event: DragEvent<HTMLDivElement>, node: Node) => {
    event.dataTransfer.effectAllowed = 'copyMove';
    const nodeData = {
      id: node.id,
      title: node.title || 'Untitled',
      dimensions: node.dimensions || []
    };
    // Store in ref for webview compatibility (dataTransfer.getData can fail in Electron/Tauri)
    draggedNodeRef.current = nodeData;
    // Set multiple MIME types for different drop targets
    event.dataTransfer.setData('application/node-info', JSON.stringify(nodeData));
    // For chat input drops - includes title for [NODE:id:"title"] token
    event.dataTransfer.setData('application/x-rah-node', JSON.stringify({ id: node.id, title: node.title || 'Untitled' }));
    // Fallback for browsers/webviews that only support text/plain
    event.dataTransfer.setData('text/plain', `[NODE:${node.id}:"${node.title || 'Untitled'}"]`);

     // Provide a compact drag preview so drop targets stay visible
    const preview = document.createElement('div');
    preview.textContent = node.title || `Node #${node.id}`;
    preview.style.position = 'fixed';
    preview.style.top = '-1000px';
    preview.style.left = '-1000px';
    preview.style.padding = '4px 8px';
    preview.style.background = '#0f0f0f';
    preview.style.color = '#f8fafc';
    preview.style.fontSize = '11px';
    preview.style.fontWeight = '600';
    preview.style.borderRadius = '6px';
    preview.style.border = '1px solid #1f1f1f';
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 6, 6);
    setTimeout(() => {
      if (preview.parentNode) {
        preview.parentNode.removeChild(preview);
      }
    }, 0);
  };

  const handleNodeTileDragEnd = () => {
    // Clear ref if drag ends without a drop
    draggedNodeRef.current = null;
  };

  const handleDimensionDragOver = (event: DragEvent<HTMLElement>) => {
    if (event.dataTransfer.types.includes('application/node-info') || event.dataTransfer.types.includes('text/plain')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDimensionDragEnter = (event: DragEvent<HTMLElement>, dimension: string) => {
    if (event.dataTransfer.types.includes('application/node-info') || event.dataTransfer.types.includes('text/plain')) {
      setDragHoverDimension(dimension);
    }
  };

  const handleDimensionDragLeave = (event: DragEvent<HTMLElement>, dimension: string) => {
    if (dragHoverDimension === dimension) {
      setDragHoverDimension(null);
    }
  };

  const handleNodeDropOnDimension = async (event: DragEvent<HTMLElement>, dimension: string) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Try to get data from ref first (works in Electron/Tauri webviews)
    let payload: { id: number; dimensions?: string[] } | null = draggedNodeRef.current;
    
    // Fallback to dataTransfer for browser compatibility
    if (!payload) {
      const raw = event.dataTransfer.getData('application/node-info') || event.dataTransfer.getData('text/plain');
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch (e) {
          console.error('Failed to parse drag data:', e);
        }
      }
    }
    
    // Clear the ref
    draggedNodeRef.current = null;
    
    if (!payload?.id) {
      console.warn('No valid node data in drop event');
      return;
    }

    try {
      const currentDimensions = payload.dimensions || [];
      if (currentDimensions.some((dim) => dim.toLowerCase() === dimension.toLowerCase())) {
        setDragHoverDimension(null);
        return;
      }

      const updatedDimensions = Array.from(new Set([...currentDimensions, dimension]));
      const response = await fetch(`/api/nodes/${payload.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dimensions: updatedDimensions })
      });

      if (!response.ok) {
        throw new Error('Failed to update node dimensions');
      }

      if (selectedDimension?.dimension === dimension) {
        fetchNodes(true);
      }
      fetchDimensions();
      onDataChanged?.();
    } catch (error) {
      console.error('Error handling node drop:', error);
      alert('Failed to add dimension to node. Please try again.');
    } finally {
      setDragHoverDimension(null);
    }
  };

  const getContentPreview = (value?: string | null): string => {
    if (!value) return '';
    const trimmed = value.trim();
    if (trimmed.length <= 160) return trimmed;
    return `${trimmed.slice(0, 160)}…`;
  };

  const _handleEditDescription = () => {
    if (!selectedDimension) return;
    setEditingDescription(true);
    setEditDescriptionText(selectedDimension.description || '');
  };

  const _handleSaveDescription = async () => {
    if (!selectedDimension) return;

    try {
      const response = await fetch('/api/dimensions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: selectedDimension.dimension, 
          description: editDescriptionText.trim()
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update description');
      }

      // Update the local selectedDimension with new description
      setSelectedDimension(prev => prev ? { ...prev, description: editDescriptionText.trim() } : null);
      
      await fetchDimensions();
      onDataChanged?.();
      setEditingDescription(false);
      setEditDescriptionText('');
    } catch (error) {
      console.error('Error updating description:', error);
      alert('Failed to update description. Please try again.');
    }
  };

  const _handleCancelDescription = () => {
    setEditingDescription(false);
    setEditDescriptionText('');
  };

  // Dimension edit modal handlers (from folder cards)
  const openDimensionEditModal = (dimension: DimensionSummary) => {
    setEditingDimensionModal(dimension);
    setEditModalName(dimension.dimension);
    setEditModalDescription(dimension.description || '');
    setEditModalIcon(dimensionIcons[dimension.dimension] || 'Folder');
    setEditModalNameError('');
  };

  const closeDimensionEditModal = () => {
    setEditingDimensionModal(null);
    setEditModalName('');
    setEditModalDescription('');
    setEditModalIcon('Folder');
    setSavingDimensionEdit(false);
    setEditModalNameError('');
  };

  const saveDimensionEdit = async () => {
    if (!editingDimensionModal) return;

    const trimmedName = editModalName.trim();
    if (!trimmedName) {
      setEditModalNameError('Name cannot be empty');
      return;
    }

    const isRenamed = trimmedName !== editingDimensionModal.dimension;
    if (isRenamed) {
      const duplicate = dimensions.some(d => d.dimension.toLowerCase() === trimmedName.toLowerCase() && d.dimension !== editingDimensionModal.dimension);
      if (duplicate) {
        setEditModalNameError('A dimension with this name already exists');
        return;
      }
    }

    setSavingDimensionEdit(true);
    setEditModalNameError('');
    try {
      // Save description (and optionally rename) via API
      const body: Record<string, string> = {
        description: editModalDescription.trim()
      };
      if (isRenamed) {
        body.currentName = editingDimensionModal.dimension;
        body.newName = trimmedName;
      } else {
        body.name = editingDimensionModal.dimension;
      }

      const response = await fetch('/api/dimensions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update dimension');
      }

      // Save icon — use new name if renamed
      const iconKey = isRenamed ? trimmedName : editingDimensionModal.dimension;
      setDimensionIcons(prev => {
        const next = { ...prev, [iconKey]: editModalIcon };
        if (isRenamed) delete next[editingDimensionModal.dimension];
        return next;
      });

      await fetchDimensions();
      onDataChanged?.();
      closeDimensionEditModal();
    } catch (error) {
      console.error('Error saving dimension:', error);
      alert('Failed to save dimension. Please try again.');
      setSavingDimensionEdit(false);
    }
  };

  const _handleEditDimensionName = () => {
    if (!selectedDimension) return;
    setEditingDimensionName(true);
    setEditDimensionNameText(selectedDimension.dimension);
  };

  const _handleSaveDimensionName = async () => {
    if (!selectedDimension || !editDimensionNameText.trim()) return;

    const newName = editDimensionNameText.trim();
    if (newName === selectedDimension.dimension) {
      // No change, just cancel
      handleCancelDimensionName();
      return;
    }

    try {
      const response = await fetch('/api/dimensions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          currentName: selectedDimension.dimension,
          newName: newName,
          description: selectedDimension.description
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update dimension name');
      }

      // Update the local selectedDimension with new name
      setSelectedDimension(prev => prev ? { ...prev, dimension: newName } : null);
      
      await fetchDimensions();
      onDataChanged?.();
      setEditingDimensionName(false);
      setEditDimensionNameText('');
    } catch (error) {
      console.error('Error updating dimension name:', error);
      alert('Failed to update dimension name. Please try again.');
    }
  };

  const handleCancelDimensionName = () => {
    setEditingDimensionName(false);
    setEditDimensionNameText('');
  };

  const renderDimensionGrid = () => {
    if (dimensionsLoading) {
      return (
        <div style={{ padding: '40px', color: '#888', textAlign: 'center' }}>
          Loading dimensions...
        </div>
      );
    }

    if (dimensionsError) {
      return (
        <div style={{ padding: '40px', color: '#f87171', textAlign: 'center' }}>
          {dimensionsError}
        </div>
      );
    }

    if (sortedDimensions.length === 0) {
      return (
        <div style={{ padding: '40px', color: '#888', textAlign: 'center' }}>
          No dimensions yet. Create one to get started.
        </div>
      );
    }

    return (
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '8px',
          alignContent: 'start'
        }}
      >
        {sortedDimensions.map((dimension) => {
          const isLocked = dimension.isPriority;
          const isDragTarget = dragHoverDimension === dimension.dimension;

          return (
            <div
              key={dimension.dimension}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectDimension(dimension)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelectDimension(dimension);
                }
              }}
              onDragOver={(event) => handleDimensionDragOver(event)}
              onDragEnter={(event) => handleDimensionDragEnter(event, dimension.dimension)}
              onDragLeave={(event) => handleDimensionDragLeave(event, dimension.dimension)}
              onDrop={(event) => handleNodeDropOnDimension(event, dimension.dimension)}
              style={{
                background: isDragTarget ? 'rgba(34, 197, 94, 0.05)' : 'transparent',
                borderLeft: isLocked ? '2px solid #22c55e' : '2px solid transparent',
                borderRadius: '6px',
                padding: '12px 14px',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                position: 'relative'
              }}
              onMouseEnter={(e) => {
                if (!isDragTarget) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isDragTarget) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {/* Dimension icon */}
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: isLocked ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <DynamicIcon
                  name={dimensionIcons[dimension.dimension] || 'Folder'}
                  size={14}
                  style={{ color: isLocked ? '#22c55e' : '#555' }}
                />
              </div>

              {/* Name and description */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: isLocked ? '#f0f0f0' : '#999',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  letterSpacing: '-0.01em'
                }}>
                  {dimension.dimension}
                </div>
                {dimension.description && (
                  <div style={{
                    fontSize: '11px',
                    color: '#555',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: '1px'
                  }}>
                    {dimension.description}
                  </div>
                )}
              </div>

              {/* Count - minimal */}
              <span style={{
                fontSize: '11px',
                fontWeight: 500,
                color: isLocked ? '#22c55e' : '#444',
                fontFamily: 'monospace',
                flexShrink: 0
              }}>
                {dimension.count}
              </span>

              {/* Action buttons - subtle */}
              <div style={{ display: 'flex', gap: '2px', flexShrink: 0, opacity: 0.4 }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openDimensionEditModal(dimension);
                  }}
                  title="Edit"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    width: '22px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#666',
                    transition: 'color 0.1s ease'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#999'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                >
                  <Edit2 size={12} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleLock(dimension.dimension);
                  }}
                  title={isLocked ? 'Unlock' : 'Lock'}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    width: '22px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: isLocked ? '#22c55e' : '#666',
                    transition: 'color 0.1s ease'
                  }}
                  onMouseEnter={(e) => { if (!isLocked) e.currentTarget.style.color = '#22c55e'; }}
                  onMouseLeave={(e) => { if (!isLocked) e.currentTarget.style.color = '#666'; }}
                >
                  {isLocked ? <Check size={12} /> : <Lock size={12} />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDimensionPendingDelete(dimension.dimension);
                  }}
                  title="Delete"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    width: '22px',
                    height: '22px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: deletingDimension === dimension.dimension ? 'not-allowed' : 'pointer',
                    color: '#666',
                    opacity: deletingDimension === dimension.dimension ? 0.3 : 1,
                    transition: 'color 0.1s ease'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                  disabled={deletingDimension === dimension.dimension}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Kanban helper functions
  const getNodesForKanbanColumn = (dimension: string) => {
    return nodes.filter(node => node.dimensions?.includes(dimension));
  };

  const handleAddKanbanColumn = (dimension: string) => {
    const newColumn = {
      dimension,
      order: kanbanColumns.length
    };
    setKanbanColumns([...kanbanColumns, newColumn]);
    setShowKanbanColumnPicker(false);
    setKanbanSearchQuery('');
  };

  const handleRemoveKanbanColumn = (dimension: string) => {
    setKanbanColumns(kanbanColumns.filter(c => c.dimension !== dimension));
  };

  const handleKanbanNodeDragStart = (e: DragEvent<HTMLDivElement>, nodeId: number, fromColumn: string) => {
    setDraggedNodeId(nodeId);
    setDraggedFromColumn(fromColumn);
    e.dataTransfer.effectAllowed = 'copyMove';
    // Find the node to get its title for chat drops
    const node = nodes.find(n => n.id === nodeId);
    const title = node?.title || 'Untitled';
    // Set MIME types for chat input and folder drops
    e.dataTransfer.setData('application/x-rah-node', JSON.stringify({ id: nodeId, title }));
    e.dataTransfer.setData('application/node-info', JSON.stringify({ id: nodeId, title, dimensions: node?.dimensions || [] }));
    e.dataTransfer.setData('text/plain', `[NODE:${nodeId}:"${title}"]`);
    // Store in ref for webview compatibility
    draggedNodeRef.current = { id: nodeId, title, dimensions: node?.dimensions || [] };
  };

  const handleKanbanNodeDragEnd = () => {
    setDraggedNodeId(null);
    setDraggedFromColumn(null);
    setDragOverColumn(null);
    draggedNodeRef.current = null;
  };

  const handleKanbanColumnDragOver = (e: DragEvent<HTMLDivElement>, columnDimension: string) => {
    e.preventDefault();
    if (draggedNodeId !== null) {
      setDragOverColumn(columnDimension);
    }
  };

  const handleKanbanColumnDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleKanbanNodeDrop = async (e: DragEvent<HTMLDivElement>, targetDimension: string) => {
    e.preventDefault();
    if (draggedNodeId === null || draggedFromColumn === targetDimension) {
      handleKanbanNodeDragEnd();
      return;
    }

    try {
      const node = nodes.find(n => n.id === draggedNodeId);
      if (!node) return;

      const currentDimensions = node.dimensions || [];
      let updatedDimensions: string[];

      if (draggedFromColumn === '__uncategorized__') {
        // Adding to a new dimension
        updatedDimensions = [...currentDimensions, targetDimension];
      } else {
        // Replace old dimension with new one
        updatedDimensions = currentDimensions.map(d =>
          d === draggedFromColumn ? targetDimension : d
        );
      }

      const response = await fetch(`/api/nodes/${draggedNodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dimensions: updatedDimensions })
      });

      if (!response.ok) {
        throw new Error('Failed to update node dimensions');
      }

      fetchNodes(true);
      onDataChanged?.();
    } catch (error) {
      console.error('Error updating node dimension:', error);
      alert('Failed to move node. Please try again.');
    } finally {
      handleKanbanNodeDragEnd();
    }
  };

  const filteredKanbanDimensions = dimensions.filter(d =>
    d.dimension.toLowerCase().includes(kanbanSearchQuery.toLowerCase()) &&
    !kanbanColumns.some(c => c.dimension === d.dimension) &&
    d.dimension !== selectedDimension?.dimension
  );

  const sortedKanbanColumns = [...kanbanColumns].sort((a, b) => a.order - b.order);

  // Render functions for each view mode
  const renderGridContent = () => (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 24px 24px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '16px',
        alignContent: 'start'
      }}
    >
      {nodes.map((node) => (
        <div
          key={node.id}
          draggable
          onDragStart={(event) => handleNodeTileDragStart(event, node)}
          onDragEnd={handleNodeTileDragEnd}
          onClick={() => {
            onNodeOpen(node.id);
            onClose();
          }}
          style={{
            background: '#0a0a0a',
            border: '1px solid #161616',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative',
            minHeight: '120px',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.2)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#111111';
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#0a0a0a';
            e.currentTarget.style.transform = 'translateY(0px)';
            e.currentTarget.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.2)';
          }}
        >
          {/* Header: ID | Title | Icon */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#22c55e',
              color: '#0a0a0a',
              fontSize: '9px',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: '3px',
              flexShrink: 0,
              fontFamily: 'monospace',
              lineHeight: 1,
              height: '16px'
            }}>
              #{node.id}
            </span>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#f8fafc',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: '1.2',
              flex: 1
            }}>
              {node.title || 'Untitled'}
            </div>
            {node.link && (
              <span style={{ flexShrink: 0 }}>
                {getNodeIcon(node, dimensionIcons)}
              </span>
            )}
          </div>
          {node.notes && (
            <div style={{
              fontSize: '12px',
              color: '#94a3b8',
              lineHeight: '1.4',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              fontWeight: 400
            }}>
              {getContentPreview(node.notes)}
            </div>
          )}
          {node.dimensions && node.dimensions.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', overflow: 'hidden', flexWrap: 'nowrap' }}>
              {node.dimensions.slice(0, 3).map((dimension, index) => {
                const isCurrentDimension = dimension === selectedDimension?.dimension;
                return (
                  <span
                    key={`${dimension}-${index}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 8px',
                      fontSize: '10px',
                      fontWeight: 500,
                      color: isCurrentDimension ? '#7de8a5' : '#cbd5e1',
                      background: isCurrentDimension ? 'rgba(125, 232, 165, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                      border: isCurrentDimension ? '1px solid rgba(125, 232, 165, 0.3)' : '1px solid rgba(148, 163, 184, 0.2)',
                      borderRadius: '8px',
                      whiteSpace: 'nowrap',
                      textTransform: 'uppercase',
                      letterSpacing: '0.025em',
                      flexShrink: 0,
                      maxWidth: '100px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {dimension}
                  </span>
                );
              })}
              {node.dimensions.length > 3 && (
                <span style={{
                  fontSize: '10px',
                  color: '#64748b',
                  fontWeight: 500,
                  padding: '3px 6px',
                  background: 'rgba(100, 116, 139, 0.1)',
                  borderRadius: '6px',
                  flexShrink: 0
                }}>
                  +{node.dimensions.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      ))}
      {nodesLoading && (
        <div style={{ padding: '20px', color: '#888' }}>Loading...</div>
      )}
      {!nodesLoading && nodes.length === 0 && (
        <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#888', paddingTop: '40px' }}>
          No nodes in this dimension yet.
        </div>
      )}
    </div>
  );

  const _renderListContent = () => (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 24px 24px'
      }}
    >
      {nodes.map((node) => (
        <button
          key={node.id}
          onClick={() => {
            onNodeOpen(node.id);
            onClose();
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '12px 16px',
            marginBottom: '4px',
            background: '#0a0a0a',
            border: '1px solid #161616',
            borderRadius: '10px',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#111';
            e.currentTarget.style.borderColor = '#222';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#0a0a0a';
            e.currentTarget.style.borderColor = '#161616';
          }}
        >
          <div style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#1a1a1a',
            borderRadius: '8px',
            flexShrink: 0
          }}>
            {getNodeIcon(node, dimensionIcons)}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '13px',
              fontWeight: 500,
              color: '#f8fafc',
              marginBottom: '4px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {node.title || 'Untitled'}
            </div>

            {node.notes && (
              <div style={{
                fontSize: '12px',
                color: '#94a3b8',
                marginBottom: '8px',
                lineHeight: '1.4',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}>
                {getContentPreview(node.notes)}
              </div>
            )}

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap'
            }}>
              {node.dimensions && node.dimensions.length > 0 && (
                <div style={{
                  display: 'flex',
                  gap: '4px',
                  flexWrap: 'wrap'
                }}>
                  {node.dimensions.slice(0, 3).map(dim => {
                    const isCurrentDimension = dim === selectedDimension?.dimension;
                    return (
                      <span
                        key={dim}
                        style={{
                          padding: '2px 6px',
                          background: isCurrentDimension ? 'rgba(125, 232, 165, 0.15)' : '#1a1a1a',
                          borderRadius: '4px',
                          fontSize: '10px',
                          color: isCurrentDimension ? '#7de8a5' : '#888',
                          textTransform: 'uppercase'
                        }}
                      >
                        {dim}
                      </span>
                    );
                  })}
                  {node.dimensions.length > 3 && (
                    <span style={{
                      padding: '2px 6px',
                      fontSize: '10px',
                      color: '#666'
                    }}>
                      +{node.dimensions.length - 3}
                    </span>
                  )}
                </div>
              )}

              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#22c55e',
                color: '#0a0a0a',
                fontSize: '9px',
                fontWeight: 600,
                padding: '1px 5px',
                borderRadius: '3px',
                flexShrink: 0,
                fontFamily: 'monospace',
                lineHeight: 1,
                height: '16px'
              }}>
                #{node.id}
              </span>
            </div>
          </div>
        </button>
      ))}
      {nodesLoading && (
        <div style={{ padding: '20px', color: '#888' }}>Loading...</div>
      )}
      {!nodesLoading && nodes.length === 0 && (
        <div style={{ textAlign: 'center', color: '#888', paddingTop: '40px' }}>
          No nodes in this dimension yet.
        </div>
      )}
    </div>
  );

  const _renderKanbanContent = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Kanban Column Setup Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 24px',
        borderBottom: '1px solid #1a1a1a',
        background: '#0a0a0a',
        flexShrink: 0
      }}>
        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>
          Group by:
        </span>

        {kanbanColumns.length === 0 && (
          <span style={{ fontSize: '11px', color: '#555', fontStyle: 'italic' }}>
            Add dimensions to create columns
          </span>
        )}

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowKanbanColumnPicker(!showKanbanColumnPicker)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#888',
              cursor: 'pointer'
            }}
          >
            <Plus size={12} />
            Add Column
          </button>

          {showKanbanColumnPicker && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              width: '200px',
              maxHeight: '300px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '8px',
              overflow: 'hidden',
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
            }}>
              <input
                type="text"
                placeholder="Search dimensions..."
                value={kanbanSearchQuery}
                onChange={(e) => setKanbanSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: '#0a0a0a',
                  border: 'none',
                  borderBottom: '1px solid #333',
                  color: '#fff',
                  fontSize: '12px',
                  outline: 'none'
                }}
                autoFocus
              />
              <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {filteredKanbanDimensions.length === 0 ? (
                  <div style={{
                    padding: '12px',
                    fontSize: '12px',
                    color: '#666',
                    textAlign: 'center'
                  }}>
                    No dimensions available
                  </div>
                ) : (
                  filteredKanbanDimensions.map(dim => (
                    <button
                      key={dim.dimension}
                      onClick={() => handleAddKanbanColumn(dim.dimension)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: 'none',
                        color: '#ccc',
                        fontSize: '12px',
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a2a'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {dim.dimension}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {showKanbanColumnPicker && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
            onClick={() => setShowKanbanColumnPicker(false)}
          />
        )}
      </div>

      {/* Kanban Board */}
      <div style={{
        flex: 1,
        display: 'flex',
        gap: '16px',
        padding: '16px 24px',
        overflowX: 'auto',
        overflowY: 'hidden'
      }}>
        {sortedKanbanColumns.map(column => {
          const columnNodes = getNodesForKanbanColumn(column.dimension);
          const isDropTarget = dragOverColumn === column.dimension && draggedFromColumn !== column.dimension;

          return (
            <div
              key={column.dimension}
              style={{
                width: '280px',
                minWidth: '280px',
                display: 'flex',
                flexDirection: 'column',
                background: isDropTarget ? '#0f2417' : '#0a0a0a',
                border: '1px solid #1a1a1a',
                borderRadius: '12px',
                transition: 'all 0.2s'
              }}
              onDragOver={(e) => handleKanbanColumnDragOver(e, column.dimension)}
              onDragLeave={handleKanbanColumnDragLeave}
              onDrop={(e) => handleKanbanNodeDrop(e, column.dimension)}
            >
              {/* Column Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                borderBottom: '1px solid #1a1a1a'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#f8fafc',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    {column.dimension}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    color: '#666',
                    background: '#1a1a1a',
                    padding: '2px 6px',
                    borderRadius: '10px'
                  }}>
                    {columnNodes.length}
                  </span>
                </div>
                <button
                  onClick={() => handleRemoveKanbanColumn(column.dimension)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    color: '#666',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Column Content */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px'
              }}>
                {columnNodes.map(node => (
                  <div
                    key={node.id}
                    draggable
                    onDragStart={(e) => handleKanbanNodeDragStart(e, node.id, column.dimension)}
                    onDragEnd={handleKanbanNodeDragEnd}
                    onClick={() => {
                      onNodeOpen(node.id);
                      onClose();
                    }}
                    style={{
                      padding: '10px',
                      marginBottom: '6px',
                      background: draggedNodeId === node.id ? '#1a1a1a' : '#111',
                      border: '1px solid #222',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      opacity: draggedNodeId === node.id ? 0.5 : 1,
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      if (draggedNodeId !== node.id) {
                        e.currentTarget.style.background = '#1a1a1a';
                        e.currentTarget.style.borderColor = '#333';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (draggedNodeId !== node.id) {
                        e.currentTarget.style.background = '#111';
                        e.currentTarget.style.borderColor = '#222';
                      }
                    }}
                  >
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 500,
                      color: '#f8fafc',
                      marginBottom: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {node.title || 'Untitled'}
                    </div>
                    {node.dimensions && node.dimensions.length > 1 && (
                      <div style={{
                        display: 'flex',
                        gap: '4px',
                        flexWrap: 'wrap',
                        marginTop: '6px'
                      }}>
                        {node.dimensions
                          .filter(d => d !== column.dimension && d !== selectedDimension?.dimension)
                          .slice(0, 2)
                          .map(dim => (
                            <span
                              key={dim}
                              style={{
                                padding: '2px 6px',
                                background: '#1a1a1a',
                                borderRadius: '4px',
                                fontSize: '10px',
                                color: '#666'
                              }}
                            >
                              {dim}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}

                {columnNodes.length === 0 && (
                  <div style={{
                    padding: '20px',
                    textAlign: 'center',
                    color: '#444',
                    fontSize: '11px'
                  }}>
                    Drop nodes here
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Empty State */}
        {kanbanColumns.length === 0 && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#666',
            fontSize: '13px'
          }}>
            Add dimension columns to organize your nodes
          </div>
        )}
      </div>
    </div>
  );

  const renderNodeGrid = () => {
    if (!selectedDimension) return null;

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '0 24px 12px', color: '#94a3b8', fontSize: '12px', fontWeight: 500 }}>
          Showing <strong style={{ color: '#f8fafc' }}>{nodes.length}</strong> nodes tagged with <strong style={{ color: '#7de8a5' }}>{selectedDimension.dimension.toUpperCase()}</strong>
        </div>

        {renderGridContent()}

        {nodesError && (
          <div style={{ padding: '12px 16px', color: '#f87171', fontSize: '12px' }}>
            {nodesError}
          </div>
        )}
        {hasMoreNodes && (
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <button
              onClick={() => fetchNodes(false)}
              disabled={nodesLoading}
              style={{
                padding: '10px 18px',
                borderRadius: '999px',
                border: '1px solid #1f1f1f',
                background: '#111',
                color: '#f1f5f9',
                cursor: nodesLoading ? 'not-allowed' : 'pointer'
              }}
            >
              {nodesLoading ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#050505',
        borderRadius: '4px',
        border: '1px solid #1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 5
      }}
    >
      {/* Header */}
      <div style={{ borderBottom: '1px solid #1a1a1a' }}>
        {/* Top row: Mode tabs + Actions */}
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Back button when viewing nodes in a dimension */}
            {view === 'nodes' && (
              <button
                onClick={handleBackToDimensions}
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  border: '1px solid #1f1f1f',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: '#cbd5f5'
                }}
              >
                <ArrowLeft size={16} />
              </button>
            )}

            {view === 'dimensions' && (
              <div style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <DynamicIcon name="Folder" size={14} style={{ color: '#22c55e' }} />
                Dimensions
              </div>
            )}

            {/* Title when viewing nodes in a dimension */}
            {view === 'nodes' && (
              <div style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>Nodes –</span>
                <span style={{ color: '#22c55e' }}>{selectedDimension?.dimension ?? ''}</span>
              </div>
            )}

          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Add Dimension button */}
            {view === 'dimensions' && (
              <button
                onClick={() => setShowAddDimensionDialog(true)}
                title="Add dimension"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  color: '#555',
                  background: 'transparent',
                  border: '1px solid #1f1f1f',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#22c55e'; e.currentTarget.style.borderColor = '#22c55e'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#1f1f1f'; }}
              >
                <Plus size={14} />
              </button>
            )}


            <button
              onClick={onClose}
              title="Close"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                border: '1px solid #1f1f1f',
                background: 'transparent',
                cursor: 'pointer',
                color: '#555',
                transition: 'all 0.15s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#888'; e.currentTarget.style.background = '#1a1a1a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; e.currentTarget.style.background = 'transparent'; }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

      </div>

      {/* Content */}
      {view === 'nodes' ? renderNodeGrid() : renderDimensionGrid()}
    </div>
    <ConfirmDialog
      open={dimensionPendingDelete !== null}
      title="Delete this dimension?"
      message={`This will remove "${dimensionPendingDelete ?? ''}" from every node.`}
      confirmLabel="Delete"
      onConfirm={() => {
        if (dimensionPendingDelete) {
          handleDeleteDimension(dimensionPendingDelete);
        }
      }}
      onCancel={() => setDimensionPendingDelete(null)}
    />
    <InputDialog
      open={showAddDimensionDialog}
      title="Add New Dimension"
      message="Enter a name for the new dimension:"
      placeholder="e.g. Research, Work, Ideas"
      confirmLabel="Create"
      onConfirm={handleAddDimension}
      onCancel={() => setShowAddDimensionDialog(false)}
    />

    {/* Dimension Edit Modal */}
    {editingDimensionModal && (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDimensionEditModal();
        }}
      >
        <div
          style={{
            background: '#0a0a0a',
            border: '1px solid #333',
            borderRadius: '12px',
            width: '480px',
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Header */}
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid #1a1a1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: editingDimensionModal.isPriority ? 'rgba(34, 197, 94, 0.1)' : '#111',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <DynamicIcon
                  name={editModalIcon}
                  size={16}
                  style={{ color: editingDimensionModal.isPriority ? '#22c55e' : '#888' }}
                />
              </div>
              <div>
                <div style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: '#e5e5e5'
                }}>
                  Edit Dimension
                </div>
                <div style={{
                  fontSize: '13px',
                  color: editingDimensionModal.isPriority ? '#22c55e' : '#888'
                }}>
                  {editingDimensionModal.dimension}
                </div>
              </div>
            </div>
            <button
              onClick={closeDimensionEditModal}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: '6px',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#666'
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div style={{
            padding: '20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}>
            {/* Description */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: '#888',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Description
              </label>
              <textarea
                value={editModalDescription}
                onChange={(e) => setEditModalDescription(e.target.value)}
                placeholder="Describe what this dimension is for..."
                maxLength={500}
                style={{
                  width: '100%',
                  minHeight: '80px',
                  padding: '12px',
                  background: '#111',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  color: '#e5e5e5',
                  fontSize: '13px',
                  resize: 'vertical',
                  outline: 'none'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#22c55e';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#333';
                }}
              />
              <div style={{
                marginTop: '4px',
                fontSize: '11px',
                color: '#555',
                textAlign: 'right'
              }}>
                {editModalDescription.length}/500
              </div>
            </div>

            {/* Icon Picker */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: '#888',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Icon
              </label>
              <LucideIconPicker
                selectedIcon={editModalIcon}
                onSelect={setEditModalIcon}
              />
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid #1a1a1a',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px'
          }}>
            <button
              onClick={closeDimensionEditModal}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid #333',
                borderRadius: '6px',
                color: '#888',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={saveDimensionEdit}
              disabled={savingDimensionEdit}
              style={{
                padding: '8px 16px',
                background: '#22c55e',
                border: 'none',
                borderRadius: '6px',
                color: '#000',
                fontSize: '13px',
                fontWeight: 600,
                cursor: savingDimensionEdit ? 'not-allowed' : 'pointer',
                opacity: savingDimensionEdit ? 0.6 : 1
              }}
            >
              {savingDimensionEdit ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
