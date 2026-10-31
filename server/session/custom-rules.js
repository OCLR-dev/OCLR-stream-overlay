// A small BP grammar, independent of rendering and of OCLR stage names.
const actors = ['red', 'blue', 'ban-first', 'other-ban', 'pick-first', 'other-pick'];
export function parseBpRule(value) {
  if (typeof value !== 'string' || value.length > 4000) throw new Error('BP 规则最多 4000 字');
  const lines = value.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length > 40) throw new Error('BP 规则最多 40 行');
  return lines.map((line, index) => {
    const [kind, actor, extra] = line.toLowerCase().split(/\s+/);
    if (!['ban', 'pick', 'alternate'].includes(kind) || !actors.includes(actor) || extra ||
        (kind === 'alternate' && index !== lines.length - 1)) {
      throw new Error(`BP 第 ${index + 1} 行无效：使用 ban / pick / alternate 加队伍；alternate 只能在最后一行`);
    }
    return { kind, actor };
  });
}
export function resolveActor(actor, roll) {
  if (actor === 'red') return 'a';
  if (actor === 'blue') return 'b';
  const first = actor.includes('ban') ? roll.banFirst : roll.pickFirst;
  return first ? actor.startsWith('other') ? first === 'a' ? 'b' : 'a' : first : null;
}
export function validBestOf(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 31 && value % 2 === 1;
}
export function normalizeWsUrl(value) {
  if (value === '') return '';
  try {
    if (typeof value !== 'string' || value.length > 500) throw new Error();
    const url = new URL(value);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    return url.href;
  } catch { throw new Error('请填写有效的 ws:// 或 wss:// 地址（不含用户名、密码或片段），或清空等待'); }
}
