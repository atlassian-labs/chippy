// Ownership checks for the directories Chippy's CLI replaces. A directory is
// Chippy's to replace when it is empty or holds a Chippy skill; anything else
// belongs to someone else and is never deleted.
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export function isChippySkill(directory) {
  const skill = join(directory, 'SKILL.md');
  return existsSync(skill) && /^name:\s*chippy\s*$/m.test(readFileSync(skill, 'utf8'));
}

export function ownsDirectory(directory) {
  return !existsSync(directory) || readdirSync(directory).length === 0 || isChippySkill(directory);
}

/** Renames a directory Chippy does not own out of the way and returns the new path. */
export function moveAside(directory, now = Date.now()) {
  const backup = `${directory}.replaced-${now}`;
  renameSync(directory, backup);
  return backup;
}
