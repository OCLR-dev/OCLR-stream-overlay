// Official osu! mod colours used by the mappool / BP broadcast.
// `bg` fills the mod block, `color` is the text colour on top of it.
export interface ModColor {
  name: string;
  bg: string;
  color: string;
  desc?: string;
  alias?: string;
}

export const MOD_COLORS = {
  // Standard / general mods.
  NF: { name: 'No Fail', bg: '#0068B7', color: '#FFFFFF' },
  EZ: { name: 'Easy', bg: '#22AC38', color: '#FFFFFF' },
  TD: { name: 'Touch Device', bg: '#7ECEF4', color: '#000000' },
  HD: { name: 'Hidden', bg: '#F8B551', color: '#FFFFFF' },
  HR: { name: 'Hard Rock', bg: '#D32F2F', color: '#FFFFFF' },
  SD: { name: 'Sudden Death', bg: '#FF9800', color: '#FFFFFF' },
  DT: { name: 'Double Time', bg: '#00A0E9', color: '#FFFFFF' },
  RX: { name: 'Relax', bg: '#BFC31F', color: '#FFFFFF' },
  HT: { name: 'Half Time', bg: '#BDBDBD', color: '#000000' },
  NC: { name: 'Nightcore', bg: '#9922EE', color: '#FFFFFF' },
  FL: { name: 'Flashlight', bg: '#000000', color: '#FFFFFF' },
  AT: { name: 'Autoplay', bg: '#00B7EE', color: '#FFFFFF' },
  SO: { name: 'Spun Out', bg: '#B28850', color: '#FFFFFF' },
  AP: { name: 'Auto Pilot', bg: '#B3D465', color: '#FFFFFF' },
  PF: { name: 'Perfect', bg: '#FFF100', color: '#000000' },

  // Other Lazer mods.
  DC: { name: 'Daycore', bg: '#DADADA', color: '#000000' },
  BL: { name: 'Blinds', bg: '#EB6100', color: '#FFFFFF' },
  ST: { name: 'Strict Tracking', bg: '#D32F2F', color: '#FFFFFF' },
  TP: { name: 'Target Practice', bg: '#920783', color: '#FFFFFF' },
  DA: { name: 'Difficulty Adjust', bg: '#601986', color: '#FFFFFF' },
  CL: { name: 'Classic', bg: '#920783', color: '#FFFFFF' },
  RD: { name: 'Random', bg: '#009944', color: '#FFFFFF' },
  MR: { name: 'Mirror', bg: '#007130', color: '#FFFFFF' },
  CN: { name: 'Cinema', bg: '#00B7EE', color: '#FFFFFF' },
  V2: { name: 'Score V2', bg: '#000000', color: '#FFFFFF' },
  SV2: { name: 'Score V2', bg: '#000000', color: '#FFFFFF' },
  SW: { name: 'Swap', bg: '#7B0046', color: '#FFFFFF' },
  FI: { name: 'Fade In', bg: '#F8B551', color: '#000000' },
  CO: { name: 'Cover', bg: '#F8B551', color: '#000000' },
  DS: { name: 'Dual Stages', bg: '#9E005E', color: '#FFFFFF' },
  IN: { name: 'Invert', bg: '#5F5BA8', color: '#FFFFFF' },
  HO: { name: 'Hold Off', bg: '#8781BE', color: '#FFFFFF' },

  // Key mods.
  '1K': { name: '1 Key', bg: '#616161', color: '#FFFFFF' },
  '2K': { name: '2 Keys', bg: '#616161', color: '#FFFFFF' },
  '3K': { name: '3 Keys', bg: '#616161', color: '#FFFFFF' },
  '4K': { name: '4 Keys', bg: '#616161', color: '#FFFFFF' },
  '5K': { name: '5 Keys', bg: '#616161', color: '#FFFFFF' },
  '6K': { name: '6 Keys', bg: '#616161', color: '#FFFFFF' },
  '7K': { name: '7 Keys', bg: '#616161', color: '#FFFFFF' },
  '8K': { name: '8 Keys', bg: '#616161', color: '#FFFFFF' },
  '9K': { name: '9 Keys', bg: '#616161', color: '#FFFFFF' },
  '10K': { name: '10 Keys', bg: '#616161', color: '#FFFFFF' },

  // Tournament / special categories.
  NM: { name: 'No Mod', bg: '#22AC38', color: '#FFFFFF', desc: '不允许玩家选择模组' },
  RC: { name: 'Rice', bg: '#22AC38', color: '#FFFFFF', desc: '含有大量普通音符的图' },
  LN: { name: 'Lone Note', bg: '#F8B551', color: '#FFFFFF', desc: '含有大量长按音符的图' },
  FE: { name: 'Free Mod', bg: '#B57BFF', color: '#FFFFFF', alias: 'FM', desc: '允许玩家任意选择模组' },
  FR: { name: 'Free Mod', bg: '#B57BFF', color: '#FFFFFF', alias: 'FM', desc: '允许玩家任意选择模组' },
  FM: { name: 'Force Mod', bg: '#9922EE', color: '#FFFFFF', desc: '玩家必须选择模组' },
  HB: { name: 'Hybrid', bg: '#00A0E9', color: '#FFFFFF', desc: '各种音符交错繁杂的图' },
  SV: { name: 'Speed Variation', bg: '#9922EE', color: '#FFFFFF', desc: '含有下落速度突变的图' },
  TB: { name: 'Tiebreaker', bg: '#000000', color: '#FFFFFF', desc: '决胜图' },

  AC: { name: 'Accuracy', bg: '#FF9800', color: '#000000', desc: '按准确率高低排名赋分' },
  ACC: { name: 'Accuracy', bg: '#FF9800', color: '#000000', desc: '按准确率高低排名赋分' },
  EX: { name: 'Extra', bg: '#FF9800', color: '#000000', desc: '额外图' },
  SP: { name: 'Special', bg: '#9E040D', color: '#FFFFFF', desc: '特殊图' },
  JB: { name: 'Jiba', bg: '#9E040D', color: '#FFFFFF', desc: '特别难打或卡手的图' },

  SV1: { name: 'ScoreV1', bg: '#000000', color: '#FFFFFF', desc: '需要采用第一版计分规则' },
  V1: { name: 'ScoreV1', bg: '#000000', color: '#FFFFFF', desc: '需要采用第一版计分规则' },

  EP: { name: 'Easy Plus', bg: '#22AC38', color: '#FFFFFF', desc: '新手追加' },
  NP: { name: 'Normal Plus', bg: '#22AC38', color: '#FFFFFF', desc: '新手追加' },

  NS: { name: 'Normal Short', bg: '#BDBDBD', color: '#000000', desc: '常规短图' },
  NL: { name: 'Normal Long', bg: '#616161', color: '#000000', desc: '常规长图' },
  HS: { name: 'Hard Short', bg: '#D32F2F', color: '#FFFFFF', desc: '困难短图' },
  HL: { name: 'Hard Long', bg: '#9E040D', color: '#FFFFFF', desc: '困难长图' },
  HP: { name: 'Hard Plus', bg: '#9922EE', color: '#FFFFFF', desc: '高手追加' },
  RU: { name: 'Rush', bg: '#FF9800', color: '#000000', desc: '冲刺图，一般很简单，让玩家多次游玩来冲刺最高分' },

  DEFAULT: { name: 'Unknown', bg: '#555555', color: '#FFFFFF', desc: '未知模组' }
} satisfies Record<string, ModColor>;

const FALLBACK_MOD_COLOR = MOD_COLORS.DEFAULT;

export function modColor(mod: string | null | undefined): ModColor {
  const key = (mod || '').toUpperCase();
  return (MOD_COLORS as Record<string, ModColor>)[key] ?? FALLBACK_MOD_COLOR;
}

export function modColorStyle(mod: string | null | undefined): Record<string, string> {
  const tone = modColor(mod);
  return { '--mod-bg': tone.bg, '--mod-ink': tone.color };
}
