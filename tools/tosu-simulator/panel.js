const byId = id => document.getElementById(id);
let current;
let busy = false;
let optionsKey = '';
let presetMode = '';
let formReady = false;
const presets = [
  ['1 · 红 Ban HD1', { mapId: 720001, ipcState: 1 }], ['2 · 蓝 Ban HR1', { mapId: 730001, ipcState: 1 }],
  ['3 · 红 Pick NM1', { mapId: 710001, ipcState: 1 }], ['4 · 准备改为 NM2', { mapId: 710002, ipcState: 1 }],
  ['5 · 进入 Playing', { ipcState: 3, left: 0, right: 0 }], ['6 · 红胜结算', { ipcState: 4, left: 1234567, right: 1100000 }],
  ['蓝胜结算', { ipcState: 4, left: 900000, right: 1200000 }], ['平分结算', { ipcState: 4, left: 1100000, right: 1100000 }],
  ['缺失队分', { ipcState: 4, left: null, right: null }], ['中途退出 3→1', { ipcState: 1 }],
  ['下一张 NM3', { ipcState: 1, mapId: 710003 }], ['池外热身', { ipcState: 1, mapId: 799999 }],
];
async function command(action, patch) {
  if (busy) return;
  busy = true; byId('error').hidden = true;
  try {
    const response = await fetch('/api/simulator/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, patch }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '模拟操作失败');
    render(data);
  } catch (error) { byId('error').textContent = error.message; byId('error').hidden = false; }
  finally { busy = false; }
}
function render(data) {
  current = data;
  const nextMode = data.offlineFixtures ? 'offline' : 'live';
  if (presetMode !== nextMode) {
    presetMode = nextMode; byId('steps').replaceChildren();
    const choices = data.offlineFixtures ? presets : presets.filter(([, patch]) => !('mapId' in patch));
    for (const [label, patch] of choices) {
      const button = document.createElement('button'); button.textContent = label.replace(/^\d+ · /, '');
      button.addEventListener('click', () => command('set', patch)); byId('steps').append(button);
    }
    byId('sourceMode').textContent = data.offlineFixtures ? '离线测试样本 · 非实机' : '仅 tosu 模拟 · 赛事资料真实只读';
    byId('sourceNotice').textContent = data.offlineFixtures ? '显式离线诊断：赛事和 tosu 均使用合成样本，存储为隔离临时会话。' : '只模拟 tosu 的 osu! 游戏信号，不提供游戏视频。赛事、场次和图池从 OCLR 真实只读 API 读取；比赛保存在本机，重置模拟信号不会清空赛事记录。';
    byId('demoNotice').textContent = data.offlineFixtures ? '固定离线测试序列：红 Ban HD1 → 蓝 Ban HR1 → 红 Pick NM1 → NM2 → Playing → Ranking。' : '先在控制台选择真实历史场次、图池并准备本图或明确当前 BP 动作，再推送本场谱面。自动演练只发送当前图的 Playing → Ranking，不编排 BP，也不重置比赛。';
    byId('demo').textContent = data.offlineFixtures ? '重置并自动演练离线样本' : '演练当前图 Playing → Ranking';
    byId('reset').textContent = data.offlineFixtures ? '重置隔离离线样本' : '重置 tosu 信号（保留比赛）';
  }
  if (!formReady) {
    byId('leftName').value = data.roomTeams.left; byId('rightName').value = data.roomTeams.right;
    formReady = true;
  }
  byId('connections').textContent = `${data.clients} 个订阅 / 累计 ${data.connections} 次连接`;
  byId('ipc').textContent = `${data.room.ipcState} · ${data.ipcName}`;
  byId('currentMap').textContent = data.maps.find(map => map.beatmapId === data.room.mapId)?.label || String(data.room.mapId);
  byId('scores').textContent = `${data.room.left?.toLocaleString() ?? '未知'} : ${data.room.right?.toLocaleString() ?? '未知'}`;
  byId('scenario').textContent = data.scenario;
  byId('mapParams').value = data.room.mapParams;
  byId('transport').textContent = data.wsUrl; byId('sent').textContent = `已发送 ${data.framesSent} 个文本帧`;
  byId('controlLink').href = `${data.appUrl}/control`; byId('outputLink').href = `${data.appUrl}/overlay`;
  for (const field of ['silent', 'invalid', 'wrongRoom', 'missingClient']) byId(field).setAttribute('aria-pressed', String(data.room[field]));
  byId('silent').textContent = data.room.silent ? '恢复发送' : '暂停发送（测试 stale）';
  byId('invalid').textContent = data.room.invalid ? '恢复有效数据' : '发送无效数据';
  byId('wrongRoom').textContent = data.room.wrongRoom ? '恢复正确房间' : '模拟错误房间';
  byId('missingClient').textContent = data.room.missingClient ? '恢复观战窗口' : '移除一路观战窗口';
  const nextOptions = JSON.stringify(data.maps.map(map => [map.id, map.beatmapId, map.label, map.title]));
  if (optionsKey !== nextOptions) {
    const previous = byId('mapSelect').value;
    byId('mapSelect').replaceChildren();
    for (const map of data.maps) { const option = document.createElement('option'); option.value = map.beatmapId; option.textContent = `${map.label} · ${map.title}`; byId('mapSelect').append(option); }
    byId('mapSelect').value = data.maps.some(map => String(map.beatmapId) === previous) ? previous : data.room.mapId;
    optionsKey = nextOptions;
  }
  if (byId('raw').open) byId('payload').textContent = JSON.stringify(data.frame, null, 2);
}
byId('frameForm').addEventListener('submit', event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  command('set', { mapId: Number(form.get('mapOverride') || form.get('mapId')), leftName: String(form.get('leftName')).trim(), rightName: String(form.get('rightName')).trim(), ipcState: Number(form.get('ipcState')), left: Number(form.get('left')), right: Number(form.get('right')), growing: form.has('growing') });
});
byId('demo').addEventListener('click', () => command('demo'));
byId('mapParams').addEventListener('change', event => command('set', { mapParams: event.target.value }));
byId('reset').addEventListener('click', () => command('reset'));
byId('disconnect').addEventListener('click', () => command('disconnect'));
byId('abort').addEventListener('click', () => command('set', { ipcState: 1 }));
byId('panic').addEventListener('click', () => command('panic'));
for (const field of ['silent', 'invalid', 'wrongRoom', 'missingClient']) byId(field).addEventListener('click', () => command('set', { [field]: !current?.room[field] }));
async function poll() {
  try { const response = await fetch('/api/simulator', { cache: 'no-store' }); if (!response.ok) throw new Error(); render(await response.json()); }
  catch { byId('connections').textContent = '模拟服务连接中断'; }
}
void poll(); const timer = setInterval(poll, 500); window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
