// Synthetic geometry for offline difficulty/packaging checks, not tournament data.
export const calculationFixture = (id = 101) => `osu file format v14
[General]
Mode:0
[Metadata]
Title:Calculation fixture
BeatmapID:${id}
BeatmapSetID:42
[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:9
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1
[TimingPoints]
0,500,4,0,0,100,1,0
[HitObjects]
${Array.from({ length: 48 }, (_, i) => `${64 + i % 4 * 112},${64 + i % 3 * 112},${1000 + i * 125},1,0,0:0:0:0:`).join('\n')}
`;
