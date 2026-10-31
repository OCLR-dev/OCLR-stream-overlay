<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { Envelope } from '../session';
import ControlSelect from './ControlSelect.vue';
const props = defineProps<{ snapshot: Envelope; disabled: boolean }>();
const edition = ref('s11');
const localOrigin = location.origin;
const tokenInput = ref<HTMLInputElement>();
const pending = ref(false);
const message = ref('');
const source = computed(() => props.snapshot.live.streaming);
const validEdition = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition.value) && edition.value.length <= 80);
const accessUrl = computed(() => `https://oclr.org/streaming/${validEdition.value ? edition.value : 's11'}`);
const status = computed(() => ({ ready: '已连接，直播任务自动更新', connecting: '正在读取直播任务', stale: '连接中断，本场记录保留，任务待更新', unauthorized: '授权已失效，请重新登录 OCLR', error: '无法读取此赛季或任务，请重新连接', disconnected: '尚未登录 OCLR 直播授权' }[source.value?.status || 'disconnected']));
let popup: Window | null = null;
let handoff: { state: string; edition: string; websiteOrigin: string } | null = null;
let popupTimer: ReturnType<typeof setInterval> | undefined;
let handoffDeadline = 0;
async function request(input: Record<string, unknown>) {
  const response = await fetch('/api/streaming', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '操作失败，请重试');
  return result;
}
function stopPopup() { clearInterval(popupTimer); popupTimer = undefined; handoff = null; popup?.close(); popup = null; }
async function login() {
  stopPopup();
  popup = window.open('about:blank', 'oclr-streaming-login', 'popup,width=620,height=760');
  if (!popup) { message.value = '登录窗口被拦截，请允许弹出窗口，或使用手动复制授权。'; return; }
  pending.value = true; message.value = '请在 OCLR 网站登录并授权，完成后自动连接直播任务。';
  try {
    const result = await request({ action: 'authorize', edition: edition.value });
    if (!popup) return;
    handoff = { state: result.state, edition: result.edition, websiteOrigin: new URL(result.authorizationUrl).origin };
    popup.location.href = result.authorizationUrl;
    handoffDeadline = Date.now() + 600000;
    popupTimer = setInterval(() => {
      if (!popup || popup.closed || Date.now() >= handoffDeadline) {
        stopPopup(); pending.value = false; message.value = '登录已取消或超时，可以重新登录；手动复制授权仍可使用。';
      }
    }, 1000);
  } catch (error) { stopPopup(); pending.value = false; message.value = error instanceof Error ? error.message : '无法打开登录，请重试'; }
}
async function receive(event: MessageEvent) {
  const active = handoff;
  if (!active || !popup || event.source !== popup || event.origin !== active.websiteOrigin ||
    event.data?.state !== active.state || event.data?.edition !== active.edition) return;
  if (event.data.type === 'oclr-streaming-ready') {
    popup.postMessage({ type: 'oclr-streaming-hello', state: active.state }, active.websiteOrigin); return;
  }
  if (event.data.type !== 'oclr-streaming-token' || typeof event.data.token !== 'string') return;
  handoff = null; clearInterval(popupTimer);
  try {
    const result = await request({ action: 'complete-authorization', state: active.state, edition: active.edition, token: event.data.token });
    if (result.status !== 'ready') throw new Error('已收到授权，但任务读取失败；请核对网站权限或稍后重试。');
    popup?.postMessage({ type: 'oclr-streaming-connected', state: active.state }, active.websiteOrigin);
    message.value = '已登录 OCLR，直播任务已自动读取。';
    popup = null;
  } catch (error) { message.value = error instanceof Error ? error.message : '自动连接失败，可以使用手动复制授权。'; }
  finally { pending.value = false; }
}
onMounted(() => window.addEventListener('message', receive));
onUnmounted(() => { window.removeEventListener('message', receive); stopPopup(); });
async function act(action: string, extra: Record<string, unknown> = {}) {
  if (pending.value && action !== 'disconnect') return;
  if (action === 'disconnect') stopPopup();
  pending.value = true; message.value = '';
  const input = tokenInput.value;
  const payload = action === 'connect' ? { action, edition: edition.value, token: input?.value || '' } :
    { action, id: crypto.randomUUID(), version: props.snapshot.session.version, fixtureId: source.value?.data?.nextFixture?.id, ...extra };
  if (input) input.value = '';
  try {
    await request(payload);
    message.value = action === 'import' ? '已使用直播任务；请核对阶段、人数和上场名单。' : action === 'disconnect' ? '已断开，本场记录保留；如需撤销凭证，请到网站操作。' : '';
  } catch (error) { message.value = error instanceof Error ? error.message : '操作失败，请重试'; }
  finally { pending.value = false; }
}
</script>
<template>
  <section class="operator-import" aria-label="OCLR 直播任务">
    <h3>OCLR 直播任务</h3>
    <p>登录后自动读取本人已指派的直播任务，选择场次即可预览；本场记录不会被自动覆盖。</p>
    <div class="setup-meta">
      <label>授权赛季<input v-model="edition" maxlength="80" :disabled="pending" autocomplete="off"></label>
      <button :disabled="disabled || pending || !validEdition" @click="login">登录 OCLR 并连接任务</button>
      <button :disabled="disabled" @click="act('disconnect')">断开连接</button>
    </div>
    <p role="status">{{ source?.edition?.toUpperCase() || 'OCLR' }} · {{ status }} · {{ source?.updatedAt || '尚无成功读取' }}</p>
    <template v-if="source?.status === 'ready' && source.tasks?.length">
      <label>选择直播任务<ControlSelect :value="source.data?.nextFixture?.id || ''" :disabled="disabled || pending" @change="act('select', { fixtureId: $event })">
        <option v-for="task in source.tasks" :key="task.nextFixture.id" :value="task.nextFixture.id">{{ task.nextFixture.label }} · {{ task.nextFixture.home?.name || '待定' }} vs {{ task.nextFixture.away?.name || '待定' }}</option>
      </ControlSelect></label>
      <p><strong>{{ source.data?.nextFixture?.label }}</strong> · {{ source.data?.stage?.roundName || '阶段待核对' }}</p>
      <p>{{ source.data?.nextFixture?.scheduledAt }} · {{ source.data?.mappools[0]?.name || '尚无公开图池，可稍后人工设置' }}</p>
      <p v-if="!source.data?.stage?.scoringRules">网站未提供完整赛制；使用任务后保留现有阶段与人数，请核对后调整。</p>
      <p>先初始化并存档已有比赛，再使用任务。网站未提供上场名单，请核对后录入。</p>
      <button :disabled="disabled || pending" @click="act('import')">使用所选直播任务</button>
    </template>
    <p v-else-if="source?.status === 'ready'">目前没有已指派且公开的直播任务。</p>
    <div v-if="source?.status === 'ready' && (source.hasMore || source.afterFixtureId)" class="setup-meta">
      <button v-if="source.afterFixtureId" :disabled="disabled || pending" @click="act('page', { afterFixtureId: null })">返回首批任务</button>
      <button v-if="source.hasMore" :disabled="disabled || pending" @click="act('page', { afterFixtureId: source.tasks?.at(-1)?.nextFixture.id })">查看更多任务</button>
    </div>
    <p v-if="snapshot.session.match.provenance === 'oclr-streaming' && source?.status !== 'ready'">本场使用此前确认的资料；授权来源当前不可用，比赛记录保留。</p>
    <p role="status">{{ message }}</p>
    <details>
      <summary>手动复制授权（备用）</summary>
      <p><a :href="accessUrl" target="_blank" rel="noopener noreferrer">打开直播授权页</a>，选择 {{ localOrigin }}，复制凭证到下方。</p>
      <label>一次性授权凭证<input ref="tokenInput" type="password" autocomplete="off" spellcheck="false" maxlength="100" :disabled="pending"></label>
      <button :disabled="disabled || pending || !validEdition" @click="act('connect')">使用复制的授权连接</button>
    </details>
  </section>
</template>
