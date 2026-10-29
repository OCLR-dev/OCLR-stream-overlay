import { access, cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SessionStore } from './session/store.js';

const exists = async path => access(path).then(() => true, () => false);

// No schema conversion: preserve the complete v1 document, undo and archives.
// Stage beside the destination so committing the migration is one rename.
export async function preparePortableData(dataDir, legacyDir) {
  if (await exists(join(dataDir, 'session.json'))) return join(dataDir, 'session.json');
  if (await exists(join(legacyDir, 'session.json'))) {
    if (await exists(dataDir)) throw new Error('DATA_MIGRATION_CONFLICT');
    await SessionStore.open(join(legacyDir, 'session.json'));
    const backup = `${legacyDir}-backup-${Date.now()}-${randomUUID()}`;
    await mkdir(backup, { recursive: true });
    await cp(join(legacyDir, 'session.json'), join(backup, 'session.json'), { errorOnExist: true, force: false });
    if (await exists(join(legacyDir, 'archive'))) await cp(join(legacyDir, 'archive'), join(backup, 'archive'), { recursive: true });
    const stage = `${dataDir}.migrating-${randomUUID()}`;
    await mkdir(dirname(dataDir), { recursive: true });
    try {
      await cp(backup, stage, { recursive: true, errorOnExist: true, force: false });
      await SessionStore.open(join(stage, 'session.json'));
      await rename(stage, dataDir);
    } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
  } else await mkdir(dataDir, { recursive: true, mode: 0o700 });
  return join(dataDir, 'session.json');
}

export async function backupBeforeVersion(dataDir, build) {
  const file = join(dataDir, 'session.json');
  const destination = join(dataDir, 'backups', build);
  if (!await exists(file) || await exists(join(destination, 'session.json'))) return;
  await mkdir(destination, { recursive: true });
  // Copy original bytes before opening with a newer application.
  const raw = await readFile(file);
  const { writeFile } = await import('node:fs/promises');
  const staged = join(destination, `session-${randomUUID()}.tmp`);
  await writeFile(staged, raw, { flag: 'wx', mode: 0o600 });
  await rename(staged, join(destination, 'session.json'));
}
