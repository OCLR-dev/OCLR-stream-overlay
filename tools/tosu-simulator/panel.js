const byId = id => document.getElementById(id);
let current;
let busy = false;
let optionsReady = false;
const presets = [
  ['1 · 红 Ban HD1', { mapId: 720001, ipcState: 1 }], ['2 · 蓝 Ban HR1', { mapId: 730001, ipcState: 1 }],
  ['3 · 红 Pick NM1', { mapId: 710001, ipcState: 1 }], ['4 · 准备改为 NM2', { mapId: 710002, ipcState: 1 }],
  ['5 · 进入 Playing', { ipcState: 3, left: 0, right: 0 }], ['6 · 红胜结算', { ipcState: 4, left: 1234567, right: 1100000 }],
  ['蓝胜结算', { ipcState: 4, left: 900000, right: 1200000 }], ['平分结算', { ipcState: 4, left: 1100000, right: 1100000 }],
  ['缺失队分', { ipcState: 4, left: null, right: null }], ['中途退出 3→1', { ipcState: 1 }],
  ['下一张 NM3', { ipcState: 1, mapId: 710003 }], ['池外热身', { ipcState: 1, mapId: 799999 }],
];
for (const [label, patch] of presets) {
  const button = document.createElement('button'); button.textContent = label;
  button.addEventListener('click', () => command('set', patch)); byId('steps').append(button);
}
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
  byId('connections').textContent = `${data.clients} 个订阅 / 累计 ${data.connections} 次连接`;
  byId('ipc').textContent = `${data.room.ipcState} · ${data.ipcName}`;
  byId('currentMap').textContent = data.maps.find(map => map.beatmapId === data.room.mapId)?.label || String(data.room.mapId);
  byId('scores').textContent = `${data.room.left?.toLocaleString() ?? '未知'} : ${data.room.right?.toLocaleString() ?? '未知'}`;
  byId('scenario').textContent = data.scenario;
  byId('transport').textContent = data.wsUrl; byId('sent').textContent = `已发送 ${data.framesSent} 个文本帧`;
  byId('controlLink').href = `${data.appUrl}/control`; byId('outputLink').href = `${data.appUrl}/overlay`;
  for (const field of ['silent', 'invalid', 'wrongRoom']) byId(field).setAttribute('aria-pressed', String(data.room[field]));
  byId('silent').textContent = data.room.silent ? '恢复发送' : '暂停发送（测试 stale）';
  byId('invalid').textContent = data.room.invalid ? '恢复有效数据' : '发送无效数据';
  byId('wrongRoom').textContent = data.room.wrongRoom ? '恢复正确房间' : '模拟错误房间';
  if (!optionsReady) {
    for (const map of data.maps) { const option = document.createElement('option'); option.value = map.beatmapId; option.textContent = `${map.label} · ${map.title}`; byId('mapSelect').append(option); }
    byId('mapSelect').value = data.room.mapId; optionsReady = true;
  }
  if (byId('raw').open) byId('payload').textContent = JSON.stringify(data.frame, null, 2);
}
byId('frameForm').addEventListener('submit', event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  command('set', { mapId: Number(form.get('mapId')), ipcState: Number(form.get('ipcState')), left: Number(form.get('left')), right: Number(form.get('right')), growing: form.has('growing') });
});
byId('demo').addEventListener('click', () => command('demo'));
byId('reset').addEventListener('click', () => command('reset'));
byId('disconnect').addEventListener('click', () => command('disconnect'));
for (const field of ['silent', 'invalid', 'wrongRoom']) byId(field).addEventListener('click', () => command('set', { [field]: !current?.room[field] }));
async function poll() {
  try { const response = await fetch('/api/simulator', { cache: 'no-store' }); if (!response.ok) throw new Error(); render(await response.json()); }
  catch { byId('connections').textContent = '模拟服务连接中断'; }
}
void poll(); const timer = setInterval(poll, 500); window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
