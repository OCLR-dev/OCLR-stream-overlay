import { parentPort, workerData } from 'node:worker_threads';
import { Beatmap, BeatmapAttributesBuilder, Difficulty, GameMode } from 'rosu-pp-js';

const flags = { NM: 0, HD: 8, HR: 16, DT: 64 };
let map; let attributes; let difficulty; let result; let response;
try {
  map = new Beatmap(workerData.body);
  if (map.mode !== GameMode.Osu || !map.nObjects || map.isSuspicious()) throw new Error('UNSUPPORTED_CALCULATION_MAP');
  const mods = flags[workerData.mod];
  if (mods === undefined) throw new Error('INVALID_CALCULATION_MOD');
  // build() consumes its WASM builder; only the returned attributes need freeing.
  attributes = new BeatmapAttributesBuilder({ map, mods }).build();
  difficulty = new Difficulty({ mods, lazer: false });
  result = difficulty.calculate(map);
  response = { calculation: { mod: workerData.mod, engine: 'rosu-pp-js@4.0.1', ruleset: 'stable',
    stars: result.stars, cs: attributes.cs, hp: attributes.hp, ar: attributes.ar, od: attributes.od, clockRate: attributes.clockRate } };
} catch { response = { error: 'BEATMAP_CALCULATION_FAILED' }; }
finally { result?.free(); difficulty?.free(); attributes?.free(); map?.free(); }
parentPort.postMessage(response);
