<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useSession, type BpAction, type PoolEntry } from '../session';
import { sceneLabels, type Scene, type Team } from '../model';
import '../control.css';

const { snapshot, connection, error, busy, command } = useSession();
const s = computed(() => snapshot.value?.session);
const live = computed(() => snapshot.value?.live);
const catalog = computed(() => snapshot.value?.catalog);
const disabled = computed(() => busy.value || connection.value !== 'synced');
const round = computed(() => s.value?.rounds.find(r => r.id === s.value?.currentRoundId));
const entry = (id?: string | null) => s.value?.pool.find(e => e.id === id);
const names = computed(() => ({ a: s.value?.match.teams.a.name || '左队', b: s.value?.match.teams.b.name || '右队' }));
const series = computed(() => s.value?.series || { a: 0, b: 0 });
const target = computed(() => s.value?.match.stage === 'final' ? 7 : 6);
const recordingPrevious = computed(() => !!resultRound.value && resultRound.value !== s.value?.currentRoundId);
const panel = computed(() => s.value?.scene || 'waiting');
const phases = [ ['waiting', '双方到场', '01'], ['roll', 'Roll / 先手', '02'], ['mappool', 'Ban / Pick', '03'], ['playing', 'Playing', '04'], ['victory', 'Winner', '05'] ] as const;
const phaseNames = { arrival: '双方到场', roll: 'Roll', bp: 'BP', playing: 'Playing', winner: 'Winner' };
const actionText = (action?: BpAction | null) => action ? `${names.value[action.team]} · ${action.kind === 'ban' ? `Ban ${(action.slot ?? 0) + 1}` : 'Pick'}` : round.value?.status === 'prepared' ? '等待开打 · 改图替换本轮' : '当前动作待设置';
const form = reactive({ title: 'OCLR S11', a: '', b: '', rosterA: '', rosterB: '', pool: '', stage: 'group', mode: '4v4', source: '4x3' });
const rollForm = reactive({ a: '', b: '', winner: '', pickFirst: '', banFirst: '' });
const autoForm = reactive({ bp: false, scenes: false, profile: 'unverified', left: '', right: '' });
const actionForm = reactive({ kind: 'ban', team: 'a', slot: 0, queue: '' });
const selection = reactive({ edition: 's11', fixtureId: '', poolId: '', leftTeamId: '', rightTeamId: '' });
const resultRound = ref('');
const winner = ref<Team>('a');
const reason = ref('');
const localError = ref('');
const settings = ref(false);
const selectedEntry = ref('');
const exForm = reactive({ team: '', a: 2, b: 2 });
const correctedScore = reactive({ a: 0, b: 0 });
const scoreEdited = ref(false);
let initialized = '';
let matchKey = '';
let rollKey = '';
let autoKey = '';
let exKey = '';
let actionKey = '';
watch(s, value => {
  if (!value) return;
  if (initialized !== value.id) {
    initialized = value.id;
    selection.edition = value.match.edition || snapshot.value?.catalog?.edition || 's11';
    settings.value = !value.pool.length;
    scoreEdited.value = false;
  }
  const nextMatchKey = JSON.stringify([value.id, value.match, value.pool]);
  if (nextMatchKey !== matchKey) {
    matchKey = nextMatchKey;
    Object.assign(form, { title: value.match.title, a: value.match.teams.a.name, b: value.match.teams.b.name,
      rosterA: value.match.teams.a.roster.map(p => p.name).join('\n'), rosterB: value.match.teams.b.roster.map(p => p.name).join('\n'),
      pool: value.pool.map(e => `${e.label} ${e.beatmapId} ${e.title}`).join('\n'), stage: value.match.stage, mode: value.match.mode, source: value.match.source });
  }
  const nextRollKey = JSON.stringify([value.id, value.roll]);
  if (rollKey !== nextRollKey) { rollKey = nextRollKey; Object.assign(rollForm, Object.fromEntries(Object.entries(value.roll).map(([k, v]) => [k, v ?? '']))); }
  const nextAutoKey = JSON.stringify([value.id, value.auto]);
  if (autoKey !== nextAutoKey) { autoKey = nextAutoKey; Object.assign(autoForm, value.auto); }
  const nextExKey = JSON.stringify([value.id, value.ex]);
  if (exKey !== nextExKey) { exKey = nextExKey; Object.assign(exForm, { team: value.ex.team || '', a: value.ex.remaining.a, b: value.ex.remaining.b }); }
  const nextActionKey = JSON.stringify([value.id, value.action, value.queue]);
  if (actionKey !== nextActionKey) {
    actionKey = nextActionKey;
    if (value.action) Object.assign(actionForm, { kind: value.action.kind, team: value.action.team, slot: value.action.slot ?? 0 });
    actionForm.queue = value.queue.map(a => `${a.team} ${a.kind}${a.kind === 'ban' ? (a.slot ?? 0) + 1 : ''}`).join('\n');
  }
  if (!scoreEdited.value) Object.assign(correctedScore, value.series);
  if (!resultRound.value || !value.rounds.some(r => r.id === resultRound.value && ['playing', 'ranking'].includes(r.status))) {
    resultRound.value = value.rounds.find(r => ['playing', 'ranking'].includes(r.status))?.id || '';
  }
});
const run = async (type: string, payload: unknown = {}) => { localError.value = ''; return command(type, payload); };
function parsePool(): PoolEntry[] {
  return form.pool.split('\n').filter(line => line.trim()).map((line, index) => {
    const match = line.trim().match(/^((NM|HD|HR|DT|FM|TB)\d*)\s+(\d+)(?:\s+(.+))?$/i);
    if (!match) throw new Error(`图池第 ${index + 1} 行：使用「标签 谱面ID 标题」格式`);
    const label = match[1]!.toUpperCase();
    return { id: label, label, mod: match[2]!.toUpperCase(), beatmapId: Number(match[3]), title: match[4] || '', artist: '', difficulty: '' };
  });
}
async function saveSetup() {
  try {
    const roster = (text: string) => text.split('\n').filter(n => n.trim()).map(name => ({ name: name.trim(), osuId: null }));
    const ok = await run('setup', { title: form.title, stage: form.stage, mode: form.mode, source: form.source,
      teams: { a: { name: form.a, roster: roster(form.rosterA) }, b: { name: form.b, roster: roster(form.rosterB) } }, pool: parsePool() });
    if (ok) settings.value = false;
  } catch (e) { localError.value = (e as Error).message; }
}
function fixtureSelected() {
  const fixture = catalog.value?.fixtures.find(f => f.id === selection.fixtureId);
  selection.poolId = fixture?.pool?.id || '';
  selection.leftTeamId = fixture?.home?.team?.id || '';
  selection.rightTeamId = fixture?.away?.team?.id || '';
}
async function importMatch() {
  if (await run('import-match', { ...selection, title: form.title, stage: form.stage, mode: form.mode, source: form.source })) settings.value = false;
}
function saveRoll(enterBp = true) {
  const numeric = (v: string) => v === '' ? null : Number(v);
  void run('roll', { a: numeric(String(rollForm.a)), b: numeric(String(rollForm.b)), winner: rollForm.winner || null, pickFirst: rollForm.pickFirst || null, banFirst: rollForm.banFirst || null, enterBp });
}
function setAction() {
  try {
    const queue = actionForm.queue.split('\n').filter(line => line.trim()).map(line => {
      const m = line.trim().match(/^([ab])\s+(ban\s*([12])|pick)$/i);
      if (!m) throw new Error('后续动作每行填写 a ban1 / b ban2 / a pick，顺序由本场确认');
      return { team: m[1]!.toLowerCase(), kind: m[3] ? 'ban' : 'pick', slot: m[3] ? Number(m[3]) - 1 : null };
    });
    void run('set-action', { action: { kind: actionForm.kind, team: actionForm.team, slot: Number(actionForm.slot) }, queue });
  } catch (e) { localError.value = (e as Error).message; }
}
const setAuto = (lock = s.value?.locked || false) => run('auto', { ...autoForm, locked: lock });
const correctSeries = async () => {
  if (await run('set-series', { ...correctedScore, reason: reason.value })) scoreEdited.value = false;
};
const display = (scene: string) => run('display', { scene });
const onKey = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || disabled.value) return;
  const element = event.target as HTMLElement;
  if (element?.isContentEditable || /INPUT|SELECT|TEXTAREA|BUTTON/.test(element?.tagName || '')) return;
  const shortcuts: Record<string, string> = { '1': 'waiting', '2': 'roll', '3': 'mappool', '4': 'playing', '5': 'victory' };
  if (shortcuts[event.key]) { event.preventDefault(); void display(shortcuts[event.key]!); }
};
onMounted(() => { document.body.classList.add('is-control'); document.title = 'OCLR · 直播员控制台'; window.addEventListener('keydown', onKey); });
onUnmounted(() => { document.body.classList.remove('is-control'); window.removeEventListener('keydown', onKey); });
const operationTime = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
</script>

<template>
  <main class="operator">
    <header class="operator-header">
      <div class="operator-brand"><span class="operator-kicker">OCLR {{ s?.match.edition?.toUpperCase() || 'S11' }} / BROADCAST</span><h1>直播员控制台</h1></div>
      <div class="operator-match"><span>{{ names.a }}</span><strong>{{ series.a }} : {{ series.b }}</strong><span>{{ names.b }}</span></div>
      <button class="operator-settings-button" :aria-expanded="settings" @click="settings = !settings">本场设置</button>
    </header>
    <div class="operator-status" aria-live="polite">
      <span :class="{ 'status-good': connection === 'synced' }">本机 {{ connection === 'synced' ? '已同步' : connection === 'connecting' ? '连接中' : '连接中断' }}</span>
      <span>tosu {{ live?.tosu.status || '未连接' }}</span><span>OCLR {{ live?.oclr.status || '未读取' }} {{ live?.oclr.error || '' }}</span>
      <span>存储 {{ snapshot?.persistence === 'ready' ? '已持久化' : snapshot?.persistence || '等待连接' }}</span>
      <span class="operator-version">v{{ s?.version ?? '—' }} · 比赛进度 {{ s ? phaseNames[s.phase] : '等待连接' }}</span>
    </div>
    <p v-if="error || localError" role="alert" class="operator-error">{{ localError || error }}</p>
    <p v-if="!s" class="operator-empty">正在连接本机会话服务。请运行 npm start，再打开 /control。</p>
    <template v-if="s">
      <section v-show="settings" class="operator-setup" aria-label="本场设置">
        <div class="operator-section-head"><h2>本场设置</h2><span>已有 BP 或赛果后，先准备下一场再替换资料</span></div>
        <div class="setup-meta">
          <label>比赛标题<input v-model="form.title" maxlength="160"></label>
          <label>阶段<select v-model="form.stage"><option value="group">小组赛 · BO11</option><option value="elimination">淘汰赛 · BO11</option><option value="final">决赛 · BO13</option></select></label>
          <label>常规人数<select v-model="form.mode"><option>3v3</option><option>4v4</option></select></label>
          <label>游戏源比例<select v-model="form.source"><option value="4x3">4:3</option><option value="16x9">16:9</option></select></label>
        </div>
        <details class="operator-import"><summary>从 OCLR 已发布资料选择</summary>
          <div class="operator-inline"><label>赛季 slug<input v-model="selection.edition" maxlength="80"></label><button :disabled="disabled" @click="run('load-edition', { edition: selection.edition })">读取赛季</button></div>
          <p>只读已发布资料；空集合保持为空，不自动填入其他赛季。</p>
          <p v-if="catalog?.kind === 'historical_archive'">{{ catalog.edition?.toUpperCase() }} 历史归档 · {{ catalog.capturedOn }} · 历史比分仅作参考，本地播出从零开始；图池未绑定的历史场次须明确选择图池。</p>
          <p v-for="warning in catalog?.warnings" :key="warning">{{ warning }}</p>
          <div class="setup-meta">
            <label>场次<select v-model="selection.fixtureId" @change="fixtureSelected"><option value="">未选择 / 人工对阵</option><option v-for="f in catalog?.fixtures" :key="f.id" :value="f.id">{{ f.roundName }} {{ f.label }}</option></select></label>
            <label>图池<select v-model="selection.poolId"><option value="">请选择</option><option v-for="p in catalog?.pools" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
            <label>左队<select v-model="selection.leftTeamId"><option value="">请选择</option><option v-for="t in catalog?.teams" :key="t.id!" :value="t.id">{{ t.name }}</option></select></label>
            <label>右队<select v-model="selection.rightTeamId"><option value="">请选择</option><option v-for="t in catalog?.teams" :key="t.id!" :value="t.id">{{ t.name }}</option></select></label>
          </div><button :disabled="disabled || live?.oclr.status !== 'ready' || !selection.poolId || !selection.leftTeamId || !selection.rightTeamId" @click="importMatch">使用所选资料</button>
        </details>
        <form @submit.prevent="saveSetup">
          <div class="setup-teams">
            <div><label>左队名称<input v-model="form.a" maxlength="80" required></label><label>左队上场名单 · 每行一人<textarea v-model="form.rosterA" rows="4" placeholder="按窗口顺序录入实际选手"></textarea></label></div>
            <div><label>右队名称<input v-model="form.b" maxlength="80" required></label><label>右队上场名单 · 每行一人<textarea v-model="form.rosterB" rows="4" placeholder="按窗口顺序录入实际选手"></textarea></label></div>
            <label>本场图池 · 每行「标签 谱面ID 标题」<textarea v-model="form.pool" rows="7" placeholder="HD2 谱面ID 标题" spellcheck="false"></textarea></label>
          </div><button class="operator-primary" :disabled="disabled">保存人工资料</button><span class="operator-hint">名单与图池来源会明确标记为人工录入。</span>
        </form>
      </section>
      <div class="operator-workspace">
        <nav class="operator-nav" aria-label="播出画面">
          <span class="operator-kicker">播出画面</span>
          <button v-for="[scene, label, no] in phases" :key="scene" :class="{ selected: s.scene === scene }" :aria-pressed="s.scene === scene" :disabled="disabled" @click="display(scene)"><span>{{ no }}</span>{{ label }}</button>
          <div class="operator-nav-divider"></div>
          <button :disabled="disabled" :class="{ selected: s.scene === 'map-result' }" @click="display('map-result')">单图结算</button>
          <button :disabled="disabled" @click="run('pause', { kind: 'technical' })">技术暂停</button>
          <button :disabled="disabled" @click="run('pause', { kind: 'tactical' })">战术暂停</button>
          <p>快捷键 1–5<br>手动切换即锁定画面</p>
          <a href="/overlay" target="_blank" rel="noopener">打开只读输出 ↗</a>
        </nav>
        <section class="operator-preview">
          <div class="operator-section-head"><h2>浏览器画面预览</h2><span>{{ sceneLabels[s.scene as Scene] }} · {{ s.locked ? '手动锁定' : '允许跟随' }}</span></div>
          <iframe src="/overlay" title="共享浏览器输出预览"></iframe>
          <div class="operator-current"><div><span>当前 BP 动作</span><strong>{{ actionText(s.action) }}</strong></div><div><span>当前轮次</span><strong>{{ round ? `#${s.rounds.filter(r => r.status !== 'void').findIndex(r => r.id === round!.id) + 1} · ${entry(round.entryId)?.label} · ${round.status}` : '尚未准备' }}</strong></div></div>
          <p class="operator-automation-note">{{ live?.note }}</p>
          <details class="operator-follow"><summary>自动跟随设置 <span>{{ s.auto.bp || s.auto.scenes ? '已启用' : '关闭' }}</span></summary>
            <p>先在直播机确认 tosu 选中实例与当前赛事房间一致，再选择客户端并填写房间中的实际队名。</p>
            <label>赛事客户端<select v-model="autoForm.profile"><option value="unverified">尚未核对</option><option value="stable-tourney">stable / osu!tourney（已核对）</option></select></label>
            <div class="operator-two"><label>房间左队名称<input v-model="autoForm.left" maxlength="80"></label><label>房间右队名称<input v-model="autoForm.right" maxlength="80"></label></div>
            <p>当前读数：{{ live?.tosu.data?.tourney?.teams.left || '—' }} / {{ live?.tosu.data?.tourney?.teams.right || '—' }} · IPC {{ live?.tosu.data?.tourney?.ipcState ?? '—' }} · 谱面 {{ live?.tosu.data?.beatmap.id ?? '—' }}</p>
            <label class="operator-check"><input v-model="autoForm.bp" type="checkbox">按当前 BP 动作自动 Ban / Pick</label>
            <label class="operator-check"><input v-model="autoForm.scenes" type="checkbox">开打 / 结算自动切换，并按最终队分加赢图</label>
            <div class="operator-inline"><button :disabled="disabled" @click="setAuto(false)">保存并解除手动锁定</button><button :disabled="disabled" @click="run('auto', { ...s.auto, locked: !s.locked })">{{ s.locked ? '解除手动锁定' : '锁定当前画面' }}</button></div>
          </details>
        </section>
        <aside class="operator-actions" aria-label="当前阶段操作">
          <div class="operator-section-head"><h2>{{ sceneLabels[s.scene as Scene] }}</h2><span>本地播出记录</span></div>
          <div v-if="panel === 'waiting'" class="operator-action-stack">
            <div v-for="team in (['a', 'b'] as const)" :key="team" class="operator-team-status"><h3>{{ names[team] }}</h3><label class="operator-check"><input type="checkbox" :checked="s.arrived[team]" :disabled="disabled" @change="run('arrival', { team, arrived: !s.arrived[team], ready: false })">已到场</label><label class="operator-check"><input type="checkbox" :checked="s.ready[team]" :disabled="disabled || !s.arrived[team]" @change="run('arrival', { team, arrived: s.arrived[team], ready: !s.ready[team] })">已就绪</label></div>
            <button class="operator-primary" :disabled="disabled" @click="run('begin-roll')">开始 Roll →</button>
          </div>
          <form v-else-if="panel === 'roll'" class="operator-action-stack" @submit.prevent="saveRoll()">
            <p>录入真实 Roll，先 Pick 与先 Ban 分开记录。</p>
            <label>{{ names.a }} Roll<input v-model="rollForm.a" type="number" min="0" step="1"></label><label>{{ names.b }} Roll<input v-model="rollForm.b" type="number" min="0" step="1"></label>
            <label v-for="[field, label] in ([['winner', 'Roll 胜方'], ['pickFirst', '先 Pick'], ['banFirst', '先 Ban']] as const)" :key="field">{{ label }}<select v-model="rollForm[field]"><option value="">未确认</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></select></label>
            <button type="button" :disabled="disabled" @click="saveRoll(false)">保存并展示 Roll 结果</button>
            <button class="operator-primary" :disabled="disabled">记录先手，进入 BP →</button>
          </form>
          <div v-else-if="panel === 'mappool'" class="operator-action-stack">
            <button v-if="s.phase !== 'bp'" class="operator-primary" :disabled="disabled" @click="run('bp')">进入 BP 操作 →</button>
            <p class="operator-action-now">{{ actionText(s.action) }}</p>
            <div class="operator-two"><label>动作<select v-model="actionForm.kind"><option value="ban">Ban</option><option value="pick">Pick</option></select></label><label>队伍<select v-model="actionForm.team"><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></select></label></div>
            <label v-if="actionForm.kind === 'ban'">Ban 槽位<select v-model="actionForm.slot"><option :value="0">Ban 1</option><option :value="1">Ban 2</option></select></label>
            <details><summary>明确的后续动作（可选）</summary><label>每行 a ban1 / b pick<textarea v-model="actionForm.queue" rows="3" placeholder="只填写本场已确认的行动顺序"></textarea></label></details>
            <button :disabled="disabled || round?.status === 'prepared'" @click="setAction">设置当前动作</button>
            <p v-if="s.queue.length">后续：{{ s.queue.map(actionText).join(' → ') }}</p>
            <label>手动选择具体条目<select v-model="selectedEntry"><option value="">选择谱面槽位</option><option v-for="e in s.pool" :key="e.id" :value="e.id">{{ e.label }} · {{ e.title || e.beatmapId }}</option></select></label>
            <button :disabled="disabled || !selectedEntry || (!s.action && round?.status !== 'prepared')" @click="run('apply-bp', { entryId: selectedEntry, actionId: s.action?.id })">{{ round?.status === 'prepared' ? '替换本轮准备图' : '执行当前 Ban / Pick' }}</button>
            <details><summary>EX 与人工次数</summary><label>开启方<select v-model="exForm.team"><option value="">未开启</option><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></select></label><div class="operator-two"><label>左队剩余<input v-model.number="exForm.a" type="number" min="0" max="2"></label><label>右队剩余<input v-model.number="exForm.b" type="number" min="0" max="2"></label></div><button :disabled="disabled" @click="run('ex', { team: exForm.team || null, remaining: { a: exForm.a, b: exForm.b } })">保存 EX 人工记录</button><p>此处调整 EX 窗口数与人工次数，切画面不扣次数。实际 EX 选手及捕获源尚待直播机接线，页面不推定减员名单。</p></details>
            <button class="operator-primary" :disabled="disabled || round?.status !== 'prepared' || !!s.action" @click="run('start')">手动进入 Playing →</button>
          </div>
          <div v-else-if="panel === 'pause'" class="operator-action-stack"><p>暂停保留原比赛进度与当前 BP 动作，自动跟随已挂起。</p><button class="operator-primary" :disabled="disabled || !s.returnScene" @click="run('resume')">返回 {{ sceneLabels[s.returnScene as Scene] || '原画面' }} →</button></div>
          <div v-else-if="panel === 'victory'" class="operator-action-stack"><h3>{{ s.winner ? names[s.winner] : '胜方待核对' }}</h3><p>人工系列分 {{ series.a }} : {{ series.b }} · 先 {{ target }}</p><button v-for="team in (['a', 'b'] as const)" :key="team" :disabled="disabled || series[team] < target" @click="run('winner', { team })">展示 {{ names[team] }} Winner</button><button class="operator-primary" :disabled="disabled" @click="run('next-match')">存档并准备下一场 →</button></div>
          <div v-else class="operator-action-stack"><p>tosu 正常结算后按稳定的最终队分自动加赢图。手动展示结算不计胜，异常可在下方撤回或校正。</p><button :disabled="disabled || round?.status !== 'playing'" @click="run('ranking')">手动展示单图结算</button><template v-for="team in (['a', 'b'] as const)" :key="team"><button v-if="series[team] >= target" class="operator-primary" :disabled="disabled" @click="run('winner', { team })">展示 {{ names[team] }} Winner →</button></template><button :disabled="disabled" @click="run('bp')">返回 BP（保留本图结果）</button></div>
          <form class="operator-result" @submit.prevent="run('record-result', { roundId: resultRound, winner })">
            <h3>记录本图结果</h3><label>待记录轮次<select v-model="resultRound"><option value="">无待记录轮次</option><option v-for="r in s.rounds.filter(r => ['playing', 'ranking'].includes(r.status))" :key="r.id" :value="r.id">{{ entry(r.entryId)?.label }} · {{ r.id.slice(0, 6) }}</option></select></label>
            <label>本图胜方<select v-model="winner"><option value="a">{{ names.a }}</option><option value="b">{{ names.b }}</option></select></label>
            <button class="operator-primary" :disabled="disabled || !resultRound">{{ recordingPrevious && series[winner] + 1 < target ? '补记上一局，保持当前画面' : `记录并${series[winner] + 1 >= target ? '展示 Winner' : '返回 BP'} →` }}</button>
          </form>
        </aside>
      </div>
      <section class="operator-records">
        <div class="operator-section-head"><h2>比赛记录</h2><button :disabled="disabled || !s.canUndo" @click="run('undo')">撤销最近一项修改</button></div>
        <div class="operator-two">
          <div><h3>单张 Ban</h3><div class="operator-ban-list"><div v-for="team in (['a', 'b'] as const)" :key="team"><strong>{{ names[team] }}</strong><div v-for="(id, index) in s.bans[team]" :key="index"><span>Ban {{ index + 1 }} · {{ entry(id)?.label || '未确认' }}</span><button v-if="id" :disabled="disabled || !reason.trim()" @click="run('clear-ban', { team, slot: index, reason })">清除修正</button></div></div></div>
            <label>修正 / 重赛原因<input v-model="reason" maxlength="160" placeholder="必填，写入操作记录"></label>
            <form class="operator-score-correction" @submit.prevent="correctSeries">
              <h3>人工校正系列比分</h3><div class="operator-two"><label>{{ names.a }} 赢图<input v-model.number="correctedScore.a" type="number" min="0" :max="target" step="1" required @input="scoreEdited = true"></label><label>{{ names.b }} 赢图<input v-model.number="correctedScore.b" type="number" min="0" :max="target" step="1" required @input="scoreEdited = true"></label></div>
              <button :disabled="disabled || !reason.trim()">应用正确系列比分</button><p>立即同步输出；保留每局原记录及校正差额，后续自动赢图在校正后的比分上继续累计。</p>
            </form>
            <div class="operator-inline"><button :disabled="disabled || !round || round.status === 'recorded' || !reason.trim()" @click="run('replay', { reason })">作废并重赛本图</button><button :disabled="disabled || !round || round.status === 'recorded' || !reason.trim()" @click="run('void-round', { reason })">作废本轮</button></div>
            <div v-for="r in s.rounds.filter(r => r.status === 'recorded')" :key="r.id" class="operator-round-record"><span>{{ entry(r.entryId)?.label }} · {{ r.winner ? names[r.winner] : '未知' }} 胜 · {{ r.resultSource === 'tosu' ? 'tosu 自动' : '人工' }}</span><div class="operator-inline"><button :disabled="disabled || !reason.trim()" @click="run('correct-result', { roundId: r.id, winner: r.winner === 'a' ? 'b' : 'a', reason })">修正胜方</button><button :disabled="disabled || !reason.trim()" @click="run('retract-result', { roundId: r.id, reason })">撤回本局计胜</button></div></div>
          </div>
          <ol class="operator-history"><li v-for="item in [...s.history].reverse().slice(0, 24)" :key="item.id"><time>{{ operationTime(item.at) }}</time><span>{{ item.message }}</span><b>{{ item.source === 'tosu' ? '房间' : '人工' }}</b></li><li v-if="!s.history.length">尚无操作记录</li></ol>
        </div>
      </section>
    </template>
  </main>
</template>
