"use client";

import { useState, useEffect, type CSSProperties } from 'react';
import { openExternalUrl } from '@/utils/openExternalUrl';

export default function ApiKeysViewer() {
  const [status, setStatus] = useState<'checking' | 'configured' | 'not-set'>('checking');

  useEffect(() => {
    // Check via health endpoint (server-side check of process.env)
    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        setStatus(data.aiFeatures?.startsWith('enabled') ? 'configured' : 'not-set');
      })
      .catch(() => setStatus('not-set'));
  }, []);

  return (
    <div style={containerStyle}>
      {/* Features explanation */}
      <div style={featuresBoxStyle}>
        <div style={featuresHeaderStyle}>OpenAI API Key enables:</div>
        <ul style={featuresListStyle}>
          <li>Auto-generated descriptions for new nodes</li>
          <li>Smart dimension assignment</li>
          <li>Semantic search via embeddings</li>
        </ul>
        <div style={noteStyle}>
          Without a key, you can still create and organise nodes manually.
        </div>
      </div>

      {/* Status */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <span style={cardTitleStyle}>OpenAI API Key</span>
          <span style={{
            fontSize: 12,
            color: status === 'configured' ? '#22c55e' :
                   status === 'checking' ? '#6b7280' : '#ef4444'
          }}>
            {status === 'configured' ? 'Configured' :
             status === 'checking' ? 'Checking...' : 'Not configured'}
          </span>
        </div>

        <div style={instructionsStyle}>
          <p style={{ margin: 0, marginBottom: 8 }}>
            Add your key to <code style={codeInlineStyle}>.env.local</code> in the project root:
          </p>
          <div style={codeBlockStyle}>
            <code>OPENAI_API_KEY=sk-your-key-here</code>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
            Restart the app after changing the key.
          </p>
        </div>
      </div>

      {/* Get key link */}
      <div style={helpStyle}>
        <button
          type="button"
          onClick={() => {
            void openExternalUrl('https://platform.openai.com/api-keys').catch((error) => {
              console.error('[ApiKeysViewer] Failed to open OpenAI API keys page', error);
              window.alert('Unable to open the OpenAI API keys page automatically.');
            });
          }}
          style={linkStyle}
        >
          Get your API key from OpenAI →
        </button>
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  padding: 24,
  height: '100%',
  overflow: 'auto',
};

const featuresBoxStyle: CSSProperties = {
  background: 'rgba(34, 197, 94, 0.08)',
  border: '1px solid rgba(34, 197, 94, 0.2)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 20,
};

const featuresHeaderStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#22c55e',
  marginBottom: 8,
};

const featuresListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  fontSize: 13,
  color: '#d1d5db',
  lineHeight: 1.6,
};

const noteStyle: CSSProperties = {
  marginTop: 12,
  fontSize: 12,
  color: '#6b7280',
  fontStyle: 'italic',
};

const cardStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.02)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
};

const cardTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#e5e7eb',
};

const instructionsStyle: CSSProperties = {
  fontSize: 13,
  color: '#d1d5db',
  lineHeight: 1.5,
};

const codeInlineStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.08)',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'monospace',
  color: '#22c55e',
};

const codeBlockStyle: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.4)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 13,
  fontFamily: 'monospace',
  color: '#e5e7eb',
  marginBottom: 8,
};

const helpStyle: CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
};

const linkStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#22c55e',
  cursor: 'pointer',
  font: 'inherit',
  padding: 0,
  textDecoration: 'none',
};
