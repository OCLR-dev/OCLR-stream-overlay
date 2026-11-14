import { normalizePool } from './session/model.js';

const slotPattern = /^(NM|HD|HR|DT|FM|TB)(?:[1-9]\d*)?$/;

export function showcasePool(entries) {
  const pool = normalizePool(entries);
  const labels = new Set();
  for (const entry of pool) {
    if (!slotPattern.test(entry.label) || entry.label.match(/^[A-Z]+/)[0] !== entry.mod) throw new Error('请使用 NM1、HD2、HR1、DT1、FM1、TB 等图池 Slot。');
    if (labels.has(entry.label)) throw new Error(`图池 Slot ${entry.label} 重复，请核对列表。`);
    labels.add(entry.label);
  }
  return pool;
}

function beatmapId(value) {
  if (/^[1-9]\d*$/.test(value)) return Number(value);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'osu.ppy.sh' || url.username || url.password || url.port || url.search) return null;
    const id = /^\/(?:beatmaps|b)\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1] ||
      (/^\/beatmapsets\/[1-9]\d*\/?$/.test(url.pathname) && /^#(?:osu|taiko|fruits|mania)\/([1-9]\d*)$/.exec(url.hash)?.[1]);
    return id ? Number(id) : null;
  } catch { return null; }
}

export function parseShowcasePool(text, previous = []) {
  if (typeof text !== 'string' || text.length > 60000) throw new Error('图池文字过长，最多 120 张谱面。');
  const entries = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = /^(\S+)\s+(\S+)(?:\s+(.+))?$/.exec(line.trim());
    const label = match?.[1].toUpperCase();
    const id = beatmapId(match?.[2] || '');
    if (!label || !slotPattern.test(label) || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`图池第 ${index + 1} 行：使用「Slot 谱面ID或链接 标题（可选）」格式，链接需包含具体难度 ID。`);
    }
    // Changing a Slot's ID cannot borrow metadata from the former difficulty.
    const old = previous.find(entry => entry.label === label && entry.beatmapId === id) || previous.find(entry => entry.beatmapId === id);
    entries.push({ id: label, label, mod: label.match(/^[A-Z]+/)[0], beatmapId: id,
      title: match[3] || '', artist: old?.artist || '', difficulty: old?.difficulty || '', ...(old?.setId ? { setId: old.setId } : {}) });
  }
  return showcasePool(entries);
}

export const showcasePoolText = pool => pool.map(entry => `${entry.label} ${entry.beatmapId}${entry.title ? ` ${entry.title}` : ''}`).join('\n');
