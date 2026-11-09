import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startSimulation } from '../tosu-simulator/stack.js';

const directory = new URL('../../test-data/tosu/windows-2026-10-31/', import.meta.url);
const bytes = await readFile(new URL('frames.ndjson', directory));
const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
const records = bytes.toString().trim().split('\n').map(line => JSON.parse(line));
const frames = records.filter(frame => frame.event === 'frame' && frame.valid);
assert.equal(frames.length, manifest.frames);
assert.equal(records.at(-1).event, 'stop');
const changes = frames.filter((frame, i) => !i || ['ipcState', 'beatmapId', 'scoreVisible'].some(key => frame[key] !== frames[i - 1][key]));
console.log(JSON.stringify({ verified: true, frames: frames.length, transitions: changes.map(frame => ({
  seconds: (frame.elapsedMs - frames[0].elapsedMs) / 1000, ipc: frame.ipcState,
  beatmapId: frame.beatmapId, scoreVisible: frame.scoreVisible,
  validPlayers: frame.clients.filter(client => client.osuId > 0).length,
})) }, null, 2));

// Reconstructed transport only: absent fields remain absent, not guessed.
export function toV2(frame) {
  return {
    simulation: true, client: frame.client,
    state: { number: frame.selectedState },
    beatmap: { id: frame.beatmapId, time: frame.time },
    tourney: { ipcState: frame.ipcState, scoreVisible: frame.scoreVisible,
      team: { left: 'Replay Left (anonymized)', right: 'Replay Right (anonymized)' },
      totalScore: frame.totalScore, points: frame.points,
      clients: frame.clients.map(client => ({ ipcId: client.ipcId, team: client.side,
        user: { id: client.osuId }, beatmap: { stats: { objects: { total: client.objects } } },
        play: { score: client.score, hits: client.hits, failed: client.failed, mode: client.mode },
      })),
    },
  };
}

if (process.argv.includes('--serve')) {
  const speedArg = process.argv.find(arg => arg.startsWith('--speed='));
  const speed = speedArg ? Number(speedArg.split('=')[1]) : 1;
  assert.ok(Number.isFinite(speed) && speed > 0 && speed <= 100, 'speed must be >0 and <=100');
  const stack = await startSimulation({ appPort: 0, wsPort: 0, offlineOclr: true,
    initialRoom: { silent: true, growing: false, chat: [] } });
  clearInterval(stack.simulator.timer);
  let current = frames[0];
  stack.simulator.room.silent = false;
  stack.simulator.wire = () => JSON.stringify(toV2(current));
  stack.simulator.broadcast();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(`Isolated historical UI replay (synthetic competition, no OCLR credentials):\n${stack.appUrl}/control\n${stack.appUrl}/overlay\nSpeed: ${speed}x. Starts in 5 seconds. Ctrl+C exits. Session: ${stack.directory}`);
  try {
    await delay(5000, undefined, { signal: controller.signal });
    for (let i = 0; i < frames.length; i++) {
      if (i) await delay(Math.max(0, (frames[i].elapsedMs - frames[i - 1].elapsedMs) / speed), undefined, { signal: controller.signal });
      current = frames[i]; stack.simulator.broadcast();
    }
    console.log('End of recording; no later results exist. Holding last frame; Ctrl+C exits.');
    while (!controller.signal.aborted) {
      stack.simulator.broadcast();
      await delay(1000, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  } finally {
    await stack.stop();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
