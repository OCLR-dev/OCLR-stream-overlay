import type { Session } from './session';
import { stages } from './model';
export function matchFormat(match?: Session['match']) {
  if (!match?.custom) return stages[match?.stage || 'group'];
  const bo = match.bestOf;
  const known = typeof bo === 'number' && Number.isInteger(bo) && bo > 0 && bo <= 31 && bo % 2 === 1;
  return { label: match.stageName || '阶段待配置', format: known ? `BO${bo}` : 'BO 待配置', target: known ? (bo + 1) / 2 : 0 };
}
