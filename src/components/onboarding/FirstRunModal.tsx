"use client";

import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { isFirstRun, markFirstRunComplete } from '@/services/storage/apiKeys';

export default function FirstRunModal() {
  const [isOpen, setIsOpen] = useState(() => isFirstRun());

  const handleClose = () => {
    markFirstRunComplete();
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return createPortal(
    <div style={overlayStyle}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={contentStyle}>
          <div style={sectionStyle}>
            <p style={sectionDescStyle}>
              To use AI features (embeddings, auto-descriptions, smart tagging),
              add your OpenAI API key to <code style={codeStyle}>.env.local</code>:
            </p>
            <div style={codeBlockStyle}>
              <code>OPENAI_API_KEY=sk-your-key-here</code>
            </div>
            <p style={costNoteStyle}>
              Then restart the app. Average cost for heavy use is less than $0.10/day.
            </p>
          </div>

          <div style={buttonSectionStyle}>
            <button onClick={handleClose} style={primaryButtonStyle}>
              Got it
            </button>
          </div>

          <div style={noteStyle}>
            <p>Without a key, you can still create and organise nodes manually.</p>
            <p style={{ marginTop: 8 }}>
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                style={linkStyle}
              >
                Get an API key from OpenAI →
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.85)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const modalStyle: CSSProperties = {
  background: '#141414',
  border: '1px solid #262626',
  borderRadius: 16,
  width: '100%',
  maxWidth: 440,
  padding: 32,
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
};

const contentStyle: CSSProperties = {};

const sectionStyle: CSSProperties = {
  marginBottom: 20,
};

const sectionDescStyle: CSSProperties = {
  fontSize: 14,
  color: '#d1d5db',
  marginBottom: 12,
  lineHeight: 1.5,
};

const codeStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.08)',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'monospace',
  color: '#22c55e',
};

const codeBlockStyle: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.4)',
  border: '1px solid #333',
  borderRadius: 8,
  padding: '12px 14px',
  fontSize: 13,
  fontFamily: 'monospace',
  color: '#e5e7eb',
  marginBottom: 12,
  overflowX: 'auto',
};

const costNoteStyle: CSSProperties = {
  fontSize: 13,
  color: '#6b7280',
};

const buttonSectionStyle: CSSProperties = {
  marginBottom: 20,
};

const primaryButtonStyle: CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  fontSize: 14,
  fontWeight: 500,
  background: '#22c55e',
  color: '#052e16',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

const noteStyle: CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  textAlign: 'center',
};

const linkStyle: CSSProperties = {
  color: '#22c55e',
  textDecoration: 'none',
};
