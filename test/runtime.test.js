import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireRuntime } from '../server/runtime.js';
import { startSimulation } from '../tools/tosu-simulator/stack.js';
import { simulationSession } from '../tools/tosu-simulator/fixture.js';
import { initialRoom } from '../tools/tosu-simulator/frames.js';
import { SessionStore } from '../server/session/store.js';

test('normal and simulated services share one runtime lease across different app ports', async () => {
  const first = await acquireRuntime({ appPort: 3007, mode: 'simulation', guardPort: 0 });
  try {
    await assert.rejects(acquireRuntime({ appPort: 3010, mode: 'production', guardPort: first.guardPort }), error => {
      assert.equal(error.code, 'OCLR_ALREADY_RUNNING');
      assert.match(error.message, /3007\/control/);
      return true;
    });
  } finally { await first.release(); }
  const restarted = await acquireRuntime({ appPort: 3007, mode: 'production', guardPort: first.guardPort });
  await restarted.release(); await restarted.release();
});

test('simulation resumes the original file and room before subscribing, without reseeding the match', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oclr-resume-test-'));
  const file = join(directory, 'session.json');
  let stack;
  try {
    const state = simulationSession();
    state.match.teams.a.name = '保留的本机队名';
    state.poolMarks = [{ entryId: 'sim-nm1', status: 'banned', team: 'b' }];
    await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    const room = { ...initialRoom(), mapId: 710003, growing: false };
    stack = await startSimulation({ offlineOclr: true, appPort: 0, wsPort: 0, sessionFile: file, initialRoom: room });
    await stack.store.tail;
    assert.equal(stack.store.file, file);
    assert.deepEqual(stack.store.state, state);
    assert.equal(stack.simulator.room.mapId, room.mapId);
    await stack.store.command({ id: crypto.randomUUID(), version: state.version, type: 'map-mark', payload: { entryId: 'sim-nm1', status: 'open', team: null } });
    await stack.stop(); stack = null;
    const reopened = await SessionStore.open(file);
    assert.equal(reopened.state.id, state.id);
    assert.equal(reopened.state.match.teams.a.name, '保留的本机队名');
    assert.deepEqual(reopened.state.poolMarks, [{ entryId: 'sim-nm1', status: 'open', team: null }]);
    await assert.rejects(startSimulation({ offlineOclr: true, appPort: 0, wsPort: 0, sessionFile: join(directory, 'missing.json') }), { code: 'ENOENT' });
  } finally { await stack?.stop(); await rm(directory, { recursive: true, force: true }); }
});
