"use client";

import { useState } from 'react';
import { Video, FileText, File, Globe } from 'lucide-react';
import { Node } from '@/types/database';
import { getIconByName } from '@/components/common/LucideIconPicker';

interface FaviconIconProps {
  domain: string;
  size?: number;
}

const FaviconIcon = ({ domain, size = 16 }: FaviconIconProps) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Globe size={size} color="#94a3b8" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`}
      width={size}
      height={size}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
};

/**
 * Resolve the icon for a node.
 *
 * Priority:
 * 1. URL-derived icon (favicon, YouTube, PDF) — if node has a link
 * 2. Dimension-derived icon — from the node's most popular dimension that has an icon set
 * 3. Fallback to generic File icon
 *
 * @param node - The database node
 * @param dimensionIcons - Map of dimension name → Lucide icon name (from DimensionIconsContext)
 * @param size - Icon size in px (default 16)
 */
export function getNodeIcon(
  node: Node,
  dimensionIcons?: Record<string, string>,
  size: number = 16,
): React.ReactElement {
  const metadataType = (
    node.metadata &&
    typeof node.metadata === 'object' &&
    !Array.isArray(node.metadata) &&
    typeof node.metadata.type === 'string'
  ) ? node.metadata.type : undefined;

  // If node has a link, use URL-derived icon (primary)
  if (node.link) {
    const url = node.link.toLowerCase();

    // YouTube videos
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return <Video size={size} color="#FF0000" />;
    }

    // PDFs and papers
    if (url.endsWith('.pdf') || metadataType === 'paper') {
      return <FileText size={size} color="#94a3b8" />;
    }

    // Website favicon with graceful fallback
    try {
      const domain = new URL(node.link).hostname;
      return <FaviconIcon domain={domain} size={size} />;
    } catch {
      return <Globe size={size} color="#94a3b8" />;
    }
  }

  // No link — try dimension-derived icon
  if (dimensionIcons && node.dimensions?.length) {
    // Find the first dimension that has an icon set
    // (dimensions are already ordered, so first match wins)
    for (const dim of node.dimensions) {
      const iconName = dimensionIcons[dim];
      if (iconName && iconName !== 'Folder') {
        const IconComponent = getIconByName(iconName);
        return <IconComponent size={size} color="#94a3b8" />;
      }
    }
  }

  // Fallback
  return <File size={size} color="#94a3b8" />;
}

/**
 * Get the dimension icon for a given dimension name.
 * Returns Folder if no icon is set.
 */
export function getDimensionIcon(
  dimensionName: string,
  dimensionIcons: Record<string, string>,
  size: number = 16,
): React.ReactElement {
  const iconName = dimensionIcons[dimensionName] || 'Folder';
  const IconComponent = getIconByName(iconName);
  return <IconComponent size={size} color="#94a3b8" />;
}
