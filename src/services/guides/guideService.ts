export {
  listSkills as listGuides,
  readSkill as readGuide,
  writeSkill as writeGuide,
  deleteSkill as deleteGuide,
  getUserSkillCount as getUserGuideCount,
  getSkillStats as getGuideStats,
} from '@/services/skills/skillService';

export type {
  SkillMeta as GuideMeta,
  Skill as Guide,
} from '@/services/skills/skillService';
