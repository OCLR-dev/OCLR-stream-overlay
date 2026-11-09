import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBeatmapMetadata, createBeatmapMetadataResolver } from '../server/beatmap-metadata.js';

const file = sections => `osu file format v14\n[Metadata]\nBeatmapID:101\nBeatmapSetID:42\n${sections}`;

test('official files provide original CS/HP/AR/OD and BPM range without applying guessed mods', () => {
  const result = parseBeatmapMetadata(file('[Difficulty]\nCircleSize:0\nHPDrainRate:4.5\nApproachRate:9.8\nOverallDifficulty:8.4\n[TimingPoints]\n0,500,4,0,0,100,1,0\n1000,-50,4,0,0,100,0,0\n2000, 250, 4, 0, 0, 100, 1, 0'), 101);
  assert.deepEqual(result, { beatmapId: 101, setId: 42, source: 'osu-file',
    title: '', titleUnicode: '', artist: '', artistUnicode: '', difficulty: '', mapper: '', length: null, objects: 0,
    stats: { cs: 0, hp: 4.5, ar: 9.8, od: 8.4, bpm: { min: 120, max: 240 } } });
});

test('missing, empty and invalid original attributes stay unknown; inherited timing points do not supply BPM', () => {
  const result = parseBeatmapMetadata(file('[Difficulty]\nCircleSize:\nHPDrainRate:NaN\nApproachRate:-1\nOverallDifficulty:Infinity\n[TimingPoints]\n0,-50,4,0,0,100,0,0\n1,500,4,0,0,100,0,0'), 101);
  assert.deepEqual(result.stats, { cs: null, hp: null, ar: null, od: null, bpm: { min: null, max: null } });
  assert.equal(parseBeatmapMetadata(file('[Difficulty]'), 102), null);
  assert.equal(parseBeatmapMetadata('<html>not an osu file</html>', 101), null);
});


test('legacy official downloads without embedded IDs retain URL identity and calculate stars; conflicting IDs reject', async () => {
  const legacy = 'osu file format v9\n[General]\nMode:0\n[Metadata]\nTitle:Legacy\nArtist:Test\nCreator:Test\nVersion:Insane\n[Difficulty]\nCircleSize:5\nHPDrainRate:7\nApproachRate:8\nOverallDifficulty:8\nSliderMultiplier:1.2\nSliderTickRate:1\n[TimingPoints]\n0,500,4,0,0,100,1,0\n[HitObjects]\n64,64,1000,1,0,0:0:0:0:\n448,320,1500,1,0,0:0:0:0:';
  assert.equal(parseBeatmapMetadata(legacy, 81958), null);
  const resolve = createBeatmapMetadataResolver(async url => {
    assert.equal(url, 'https://osu.ppy.sh/osu/81958'); return new Response(legacy);
  }, { gapMs: 0 });
  const metadata = await resolve(81958, 'NM');
  assert.equal(metadata.beatmapId, 81958); assert.equal(metadata.difficulty, 'Insane');
  assert.ok(Number.isFinite(metadata.calculation.stars));
  const conflicting = createBeatmapMetadataResolver(async () => new Response(legacy.replace('[Metadata]', '[Metadata]\nBeatmapID:102')), { gapMs: 0 });
  assert.equal(await conflicting(81958, 'NM'), null);
});
