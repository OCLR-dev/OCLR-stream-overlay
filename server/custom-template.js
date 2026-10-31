import { newCustomSession, requireValue, transition } from './session/model.js';
import { randomUUID } from 'node:crypto';

// Configuration only: never import scores, runs, actual room names or tosu intent
// from a remote match, a previous rehearsal or a different computer.
export function sessionFromTemplate(template) {
  requireValue(template?.format === 'custom-match-config-v1', '赛事配置文件格式无效');
  requireValue(!template.bpPreset || !template.bpRule?.trim(), '预设流程与文字 BP 规则不能同时配置');
  let s = newCustomSession();
  const apply = (type, payload) => { s = transition(s, { id: randomUUID(), version: s.version, type, payload }); };
  for (const field of ['title', 'stageName', 'bestOf']) apply('setting', { field, value: template[field] });
  for (const team of ['a', 'b']) {
    apply('setting', { field: 'team-name', team, value: template.teams?.[team]?.name });
    apply('setting', { field: 'roster', team, value: template.teams?.[team]?.roster || [] });
  }
  apply('setting', { field: 'pool', value: template.pool });
  if (template.bpPreset) apply('set-bp-preset', { value: template.bpPreset });
  else apply('set-bp-rule', { value: template.bpRule || '' });
  s.version = 0; s.history = []; s.undo = []; s.commandIds = [];
  return s;
}
