import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBeatmapMetadata } from '../server/beatmap-metadata.js';

const file = sections => `osu file format v14\n[Metadata]\nBeatmapID:101\nBeatmapSetID:42\n${sections}`;

test('official files provide original CS/HP/AR/OD and BPM range without applying guessed mods', () => {
  const result = parseBeatmapMetadata(file('[Difficulty]\nCircleSize:0\nHPDrainRate:4.5\nApproachRate:9.8\nOverallDifficulty:8.4\n[TimingPoints]\n0,500,4,0,0,100,1,0\n1000,-50,4,0,0,100,0,0\n2000, 250, 4, 0, 0, 100, 1, 0'), 101);
  assert.deepEqual(result, { beatmapId: 101, setId: 42, source: 'osu-file',
    stats: { cs: 0, hp: 4.5, ar: 9.8, od: 8.4, bpm: { min: 120, max: 240 } } });
});

test('missing, empty and invalid original attributes stay unknown; inherited timing points do not supply BPM', () => {
  const result = parseBeatmapMetadata(file('[Difficulty]\nCircleSize:\nHPDrainRate:NaN\nApproachRate:-1\nOverallDifficulty:Infinity\n[TimingPoints]\n0,-50,4,0,0,100,0,0\n1,500,4,0,0,100,0,0'), 101);
  assert.deepEqual(result.stats, { cs: null, hp: null, ar: null, od: null, bpm: { min: null, max: null } });
  assert.equal(parseBeatmapMetadata(file('[Difficulty]'), 102), null);
  assert.equal(parseBeatmapMetadata('<html>not an osu file</html>', 101), null);
});
