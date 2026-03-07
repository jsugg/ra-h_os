"use client";

import { useState, useEffect } from 'react';
import { ArrowLeft, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PaneHeader from './PaneHeader';
import type { BasePaneProps } from './types';

interface SkillMeta {
  name: string;
  description: string;
  immutable: boolean;
}

interface Skill extends SkillMeta {
  content: string;
}

export default function SkillsPane({
  slot,
  onCollapse,
  onSwapPanes,
  tabBar,
}: BasePaneProps) {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchSkills();

    const handleSkillUpdated = () => {
      fetchSkills();
    };
    window.addEventListener('skills:updated', handleSkillUpdated);
    window.addEventListener('guides:updated', handleSkillUpdated);

    return () => {
      window.removeEventListener('skills:updated', handleSkillUpdated);
      window.removeEventListener('guides:updated', handleSkillUpdated);
    };
  }, []);

  const fetchSkills = async () => {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      if (data.success) {
        setSkills(data.data);
      }
    } catch (err) {
      console.error('[SkillsPane] Failed to fetch skills:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSkill = async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
      const data = await res.json();
      if (data.success) {
        setSelectedSkill(data.data);
      }
    } catch (err) {
      console.error('[SkillsPane] Failed to fetch skill:', err);
    }
  };

  const handleDeleteSkill = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete skill "${name}"?`)) return;

    setDeleting(name);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchSkills();
        if (selectedSkill?.name === name) {
          setSelectedSkill(null);
        }
      }
    } catch (err) {
      console.error('[SkillsPane] Failed to delete skill:', err);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      <PaneHeader slot={slot} onCollapse={onCollapse} onSwapPanes={onSwapPanes} tabBar={tabBar}>
        {selectedSkill ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setSelectedSkill(null)}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '4px',
                borderRadius: '4px',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = '#ccc';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = '#888';
              }}
            >
              <ArrowLeft size={16} />
            </button>
            <span style={{ color: '#ccc', fontSize: '13px', fontWeight: 500 }}>{selectedSkill.name}</span>
          </div>
        ) : (
          <span style={{ color: '#666', fontSize: '11px' }}>{skills.length} skills</span>
        )}
      </PaneHeader>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px' }}>
        {loading ? (
          <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', paddingTop: '24px' }}>Loading...</div>
        ) : selectedSkill ? (
          <div className="skill-content" style={{ color: '#ccc', fontSize: '13px', lineHeight: '1.6' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedSkill.content}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {skills.length === 0 ? (
              <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', paddingTop: '24px' }}>
                No skills found
              </div>
            ) : (
              skills.map((skill) => (
                <button
                  key={skill.name}
                  onClick={() => handleSelectSkill(skill.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px',
                    background: '#161616',
                    border: '1px solid #222',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = '#1a1a1a';
                    e.currentTarget.style.borderColor = '#333';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = '#161616';
                    e.currentTarget.style.borderColor = '#222';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: '#ddd', fontSize: '13px', fontWeight: 500 }}>{skill.name}</span>
                    <span
                      style={{
                        color: '#777',
                        fontSize: '12px',
                        lineHeight: '1.4',
                        display: 'block',
                        marginTop: '2px',
                      }}
                    >
                      {skill.description}
                    </span>
                  </div>
                  <button
                    onClick={e => handleDeleteSkill(skill.name, e)}
                    disabled={deleting === skill.name}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#555',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                      opacity: deleting === skill.name ? 0.3 : 1,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = '#ef4444';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = '#555';
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
