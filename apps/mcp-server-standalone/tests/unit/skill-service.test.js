'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { describe, it, beforeAll, afterAll, assert, run } = require(
  path.resolve(__dirname, '../framework.js')
);
const { clearModuleCache } = require(
  path.resolve(__dirname, '../helpers.js')
);

describe('skillService list cache', () => {
  let skillService;
  let tempHome;
  let originalHome;
  let skillsDir;

  beforeAll(() => {
    originalHome = process.env.HOME;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'utu-skills-'));
    process.env.HOME = tempHome;
    clearModuleCache();

    skillService = require(path.resolve(__dirname, '../../services/skillService.js'));
    skillService.listSkills();
    skillsDir = path.join(tempHome, 'Library', 'Application Support', 'RA-H', 'skills');
  });

  afterAll(() => {
    clearModuleCache();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('writeSkill invalidates cached skill metadata immediately', () => {
    const before = skillService.listSkills();

    skillService.writeSkill(
      'cache-write-test',
      [
        '---',
        'name: Cache Write Test',
        'description: Added during cache invalidation test.',
        '---',
        'Cache write body.',
      ].join('\n')
    );

    const after = skillService.listSkills();

    assert.strictEqual(after.length, before.length + 1);
    assert.ok(
      after.some((skill) =>
        skill.name === 'Cache Write Test' &&
        skill.description === 'Added during cache invalidation test.'
      )
    );
  });

  it('deleteSkill invalidates cached skill metadata immediately', () => {
    skillService.writeSkill(
      'cache-delete-test',
      [
        '---',
        'name: Cache Delete Test',
        'description: Removed during cache invalidation test.',
        '---',
        'Cache delete body.',
      ].join('\n')
    );

    assert.ok(skillService.listSkills().some((skill) => skill.name === 'Cache Delete Test'));

    const result = skillService.deleteSkill('cache-delete-test');
    const after = skillService.listSkills();

    assert.deepStrictEqual(result, { success: true });
    assert.ok(!after.some((skill) => skill.name === 'Cache Delete Test'));
  });

  it('external file edits refresh cached metadata on the next list call', () => {
    skillService.writeSkill(
      'cache-refresh-test',
      [
        '---',
        'name: Cache Refresh Test',
        'description: Initial description.',
        '---',
        'Original body.',
      ].join('\n')
    );

    const filepath = path.join(skillsDir, 'cache-refresh-test.md');
    fs.writeFileSync(
      filepath,
      [
        '---',
        'name: Cache Refresh Test',
        'description: Updated from disk.',
        '---',
        'Updated body with a different size.',
      ].join('\n'),
      'utf-8'
    );

    const after = skillService.listSkills();
    const refreshed = after.find((skill) => skill.name === 'Cache Refresh Test');

    assert.ok(refreshed, 'Expected skill to remain present after external edit');
    assert.strictEqual(refreshed.description, 'Updated from disk.');
  });
});

run('Ra-h — SkillService').then(process.exit);
