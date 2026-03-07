import fs from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';

export interface SkillMeta {
  name: string;
  description: string;
  immutable: boolean;
}

export interface Skill extends SkillMeta {
  content: string;
}

const SKILLS_DIR = path.join(
  os.homedir(),
  'Library/Application Support/RA-H/skills'
);

const LEGACY_GUIDES_DIR = path.join(
  os.homedir(),
  'Library/Application Support/RA-H/guides'
);

const BUNDLED_SKILLS_DIR = path.join(
  process.cwd(),
  'src/config/skills'
);

const SEEDED_SKILL_IDS = new Set([
  'db-operations',
  'create-skill',
  'audit',
  'traverse',
  'onboarding',
  'persona',
  'calibration',
  'connect',
]);

function ensureSkillsDir(): void {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

function stripMdExtension(value: string): string {
  return value.replace(/\.md$/i, '');
}

function normalizeSkillId(value: string): string {
  return stripMdExtension(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

function migrateLegacyGuides(): void {
  const guideFiles = listMarkdownFiles(LEGACY_GUIDES_DIR);
  for (const file of guideFiles) {
    const target = path.join(SKILLS_DIR, file);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(path.join(LEGACY_GUIDES_DIR, file), target);
    }
  }
}

function seedSkills(): void {
  const bundledFiles = listMarkdownFiles(BUNDLED_SKILLS_DIR);
  const bundledById = new Map<string, string>();

  for (const file of bundledFiles) {
    bundledById.set(normalizeSkillId(file), path.join(BUNDLED_SKILLS_DIR, file));
  }

  for (const skillId of SEEDED_SKILL_IDS) {
    const source = bundledById.get(skillId);
    if (!source) continue;

    const dest = path.join(SKILLS_DIR, `${skillId}.md`);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(source, dest);
    }
  }
}

function resolveSkillFilename(name: string): string | null {
  const files = listMarkdownFiles(SKILLS_DIR);
  const normalizedInput = normalizeSkillId(name);

  const directCandidates = [
    `${name}.md`,
    `${name.toLowerCase()}.md`,
    normalizedInput ? `${normalizedInput}.md` : '',
  ].filter(Boolean);

  for (const candidate of directCandidates) {
    if (files.includes(candidate)) {
      return candidate;
    }
  }

  for (const file of files) {
    if (normalizeSkillId(file) === normalizedInput) {
      return file;
    }

    const raw = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8');
    const { data } = matter(raw);
    if (typeof data.name === 'string' && normalizeSkillId(data.name) === normalizedInput) {
      return file;
    }
  }

  return null;
}

let initialized = false;

function init(): void {
  if (initialized) return;
  ensureSkillsDir();
  migrateLegacyGuides();
  seedSkills();
  initialized = true;
}

export function listSkills(): SkillMeta[] {
  init();
  const files = listMarkdownFiles(SKILLS_DIR);

  const skills = files.map((file) => {
    const raw = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8');
    const { data } = matter(raw);

    return {
      name: data.name || file.replace('.md', ''),
      description: data.description || '',
      immutable: false,
    };
  });

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkill(name: string): Skill | null {
  init();

  const filename = resolveSkillFilename(name);
  if (!filename) return null;

  const filepath = path.join(SKILLS_DIR, filename);
  const raw = fs.readFileSync(filepath, 'utf-8');
  const { data, content } = matter(raw);

  return {
    name: data.name || stripMdExtension(filename),
    description: data.description || '',
    immutable: false,
    content: content.trim(),
  };
}

export function writeSkill(name: string, content: string): { success: boolean; error?: string } {
  init();
  const normalizedName = normalizeSkillId(name);
  const existingFilename = resolveSkillFilename(name);
  const filename = existingFilename || `${normalizedName || name.toLowerCase()}.md`;

  const filepath = path.join(SKILLS_DIR, filename);
  fs.writeFileSync(filepath, content, 'utf-8');
  return { success: true };
}

export function deleteSkill(name: string): { success: boolean; error?: string } {
  init();

  const filename = resolveSkillFilename(name);
  if (!filename) {
    return { success: false, error: `Skill "${name}" not found.` };
  }

  const filepath = path.join(SKILLS_DIR, filename);
  fs.unlinkSync(filepath);
  return { success: true };
}

export function getUserSkillCount(): number {
  init();
  return listMarkdownFiles(SKILLS_DIR).length;
}

export function getSkillStats(): { userSkills: number; maxUserSkills: number; systemSkills: number } {
  const count = getUserSkillCount();
  return {
    userSkills: count,
    maxUserSkills: 9999,
    systemSkills: 0,
  };
}

// Compatibility aliases for legacy guide-first code paths.
export type GuideMeta = SkillMeta;
export type Guide = Skill;

export const listGuides = listSkills;
export const readGuide = readSkill;
export const writeGuide = writeSkill;
export const deleteGuide = deleteSkill;

export function getUserGuideCount(): number {
  return getUserSkillCount();
}

export function getGuideStats(): { userGuides: number; maxUserGuides: number; systemGuides: number } {
  const stats = getSkillStats();
  return {
    userGuides: stats.userSkills,
    maxUserGuides: stats.maxUserSkills,
    systemGuides: stats.systemSkills,
  };
}
