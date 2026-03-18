"use client";

import { useMemo, useCallback } from 'react';

interface RawFormatterProps {
  content: string;
  onTextSelect?: (text: string) => void;
  highlightedText?: string | null;
  highlightMatchIndex?: number;
}

function countMatches(text: string, searchLower: string): number {
  if (!searchLower) return 0;

  const textLower = text.toLowerCase();
  let matchCount = 0;
  let pos = 0;

  while (pos < textLower.length) {
    const index = textLower.indexOf(searchLower, pos);
    if (index === -1) break;
    matchCount += 1;
    pos = index + 1;
  }

  return matchCount;
}

/**
 * Raw/Typography formatter for the Source Reader
 * Applies comfortable reading typography without any content transformation
 * Works as the default/fallback for all content types
 */
export default function RawFormatter({ content, onTextSelect, highlightedText, highlightMatchIndex = 0 }: RawFormatterProps) {
  // Handle text selection - fires on mouseup
  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim();

    // Only trigger for meaningful selections (>10 chars)
    if (text && text.length > 10) {
      // Truncate very long selections to 2000 chars
      const truncatedText = text.length > 2000
        ? text.slice(0, 2000) + '...'
        : text;
      onTextSelect(truncatedText);
      // Clear browser selection so our custom highlight shows
      selection?.removeAllRanges();
    }
  }, [onTextSelect]);

  // Split content into paragraphs for better rendering
  const paragraphs = useMemo(() => {
    if (!content) return [];

    // Split on double newlines to detect paragraphs
    // But preserve single newlines within paragraphs
    return content
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
  }, [content]);

  const paragraphMatchOffsets = useMemo(() => {
    if (!highlightedText) {
      return paragraphs.map(() => 0);
    }

    const searchLower = highlightedText.toLowerCase();
    let runningOffset = 0;

    return paragraphs.map((paragraph) => {
      const offset = runningOffset;
      runningOffset += countMatches(paragraph, searchLower);
      return offset;
    });
  }, [highlightedText, paragraphs]);

  // Render text with all highlights, marking current one specially
  const renderWithHighlight = (text: string, matchOffset: number): React.ReactNode => {
    if (!highlightedText) return text;

    const textLower = text.toLowerCase();
    const searchLower = highlightedText.toLowerCase();

    if (!textLower.includes(searchLower)) {
      return text;
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let pos = 0;
    let localMatchIndex = 0;

    while (pos < textLower.length) {
      const index = textLower.indexOf(searchLower, pos);
      if (index === -1) break;

      if (index > lastIndex) {
        parts.push(text.slice(lastIndex, index));
      }

      const isCurrent = matchOffset + localMatchIndex === highlightMatchIndex;
      localMatchIndex += 1;

      parts.push(
        <mark
          key={`match-${index}`}
          data-search-match={isCurrent ? 'current' : 'other'}
          style={{
            background: isCurrent ? 'rgba(250, 204, 21, 0.4)' : 'rgba(168, 85, 247, 0.2)',
            color: isCurrent ? '#fef08a' : '#e9d5ff',
            padding: '2px 0',
            borderRadius: '2px',
          }}
        >
          {text.slice(index, index + highlightedText.length)}
        </mark>
      );

      lastIndex = index + highlightedText.length;
      pos = index + 1;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? <>{parts}</> : text;
  };

  if (!content) {
    return (
      <div style={{
        color: '#555',
        fontSize: '15px',
        fontStyle: 'italic',
        textAlign: 'center',
        padding: '40px 20px',
      }}>
        No source content
      </div>
    );
  }

  return (
    <div 
      onMouseUp={handleMouseUp}
      style={{
        maxWidth: '680px',
        margin: '0 auto',
        padding: '24px 16px',
      }}
    >
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: '15px',
            lineHeight: '1.7',
            color: '#d4d4d4',
            margin: 0,
            marginBottom: index < paragraphs.length - 1 ? '1.5em' : 0,
            whiteSpace: 'pre-wrap', // Preserve single newlines within paragraphs
            wordWrap: 'break-word',
          }}
        >
          {renderWithHighlight(paragraph, paragraphMatchOffsets[index] ?? 0)}
        </p>
      ))}
    </div>
  );
}
