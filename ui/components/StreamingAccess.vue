<script setup lang="ts">
import { computed, ref } from 'vue';
import { streamingRequest, useStreamingLogin } from '../streamingLogin';
import type { Envelope } from '../session';
import { exhibitionFormat } from '../model';
import ControlSelect from './ControlSelect.vue';
import { CalendarDays, Check, Settings2, LogIn, Unplug, ArrowRight } from '@lucide/vue';
const props = defineProps<{ snapshot: Envelope; disabled: boolean }>();
const edition = ref('s11');
const localOrigin = location.origin;
const tokenInput = ref<HTMLInputElement>();
const { pending, pendingAction, message, login, stopPopup } = useStreamingLogin(() => {
  message.value = '已登录 OCLR，直播任务已自动读取。';
});
const source = computed(() => props.snapshot.live.streaming);
const currentTask = computed(() => props.snapshot.session.match.provenance === 'oclr-streaming' &&
  props.snapshot.session.match.fixtureId === source.value?.data?.nextFixture?.id);
const connectionSettings = ref(false);
function localTime(value: string | null | undefined, date = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return date ? '时间待定' : '尚无更新';
  return new Intl.DateTimeFormat('zh-CN', date ? { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' } :
    { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
const connected = computed(() => ['ready', 'connecting', 'stale'].includes(source.value?.status || ''));
const connectionLabel = computed(() => {
  if (pending.value) return pendingAction.value === 'login' ? '正在登录 OCLR…' :
    pendingAction.value === 'connect' ? '正在连接任务…' : pendingAction.value === 'disconnect' ? '正在断开连接…' : '正在处理…';
  if (connected.value) return '断开连接';
  return ['unauthorized', 'error'].includes(source.value?.status || '') ? '重新登录 OCLR 并连接任务' : '登录 OCLR 并连接任务';
});
const validEdition = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition.value) && edition.value.length <= 80);
const accessUrl = computed(() => `https://oclr.org/streaming/${validEdition.value ? edition.value : 's11'}`);
const status = computed(() => ({ ready: '已连接，直播任务自动更新', connecting: '正在读取直播任务', stale: '连接中断，本场记录保留，任务待更新', unauthorized: '授权已失效，请重新登录 OCLR', error: '无法读取此赛季或任务，请重新连接', disconnected: '尚未登录 OCLR 直播授权' }[source.value?.status || 'disconnected']));
async function act(action: string, extra: Record<string, unknown> = {}) {
  if (pending.value && action !== 'disconnect') return;
  if (action === 'disconnect') stopPopup();
  pendingAction.value = action; pending.value = true; message.value = '';
  const input = tokenInput.value;
  const payload = action === 'connect' ? { action, edition: edition.value, token: input?.value || '' } :
    { action, id: crypto.randomUUID(), version: props.snapshot.session.version, fixtureId: source.value?.data?.nextFixture?.id, ...extra };
  if (input) input.value = '';
  try {
    await streamingRequest(payload);
    message.value = action === 'import' ? '已使用直播任务；请核对阶段、人数和上场名单。' : action === 'disconnect' ? '已断开，本场记录保留；如需撤销凭证，请到网站操作。' : '';
  } catch (error) { message.value = error instanceof Error ? error.message : '操作失败，请重试'; }
  finally { pending.value = false; }
}
</script>
<template>
  <section class="operator-import streaming-access" aria-label="OCLR 直播任务">
    <div class="streaming-status-row">
      <span class="streaming-connection" :class="{ 'status-good': source?.status === 'ready' }"><Check v-if="source?.status === 'ready'" :size="16" aria-hidden="true" />{{ source?.edition?.toUpperCase() || edition.toUpperCase() }} · {{ status }}</span>
      <button v-if="connected" class="streaming-settings-button" :aria-expanded="connectionSettings" @click="connectionSettings = !connectionSettings"><Settings2 :size="16" aria-hidden="true" />连接设置</button>
    </div>
    <div v-show="!connected || connectionSettings" class="streaming-connection-settings">
      <div class="setup-meta">
        <label>授权赛季<input v-model="edition" maxlength="80" :disabled="pending" autocomplete="off"></label>
        <button class="streaming-connection-button" :disabled="disabled || pending || (!connected && !validEdition)" :aria-busy="pending" @click="connected ? act('disconnect') : login(edition)"><Unplug v-if="connected" :size="16" aria-hidden="true" /><LogIn v-else :size="16" aria-hidden="true" />{{ connectionLabel }}</button>
      </div>
      <details>
        <summary>手动复制授权（备用）</summary>
        <p><a :href="accessUrl" data-desktop-link="streaming-page" :data-edition="validEdition ? edition : 's11'" target="_blank" rel="noopener noreferrer">打开直播授权页</a>，选择 {{ localOrigin }}，复制凭证到下方。</p>
        <label>一次性授权凭证<input ref="tokenInput" type="password" autocomplete="off" spellcheck="false" maxlength="100" :disabled="pending"></label>
        <button :disabled="disabled || pending || !validEdition" @click="act('connect')">使用复制的授权连接</button>
      </details>
    </div>
    <template v-if="source?.status === 'ready' && source.tasks?.length">
      <label class="streaming-task-select">直播任务<ControlSelect :value="source.data?.nextFixture?.id || ''" :disabled="disabled || pending" @change="act('select', { fixtureId: $event })">
        <option v-for="task in source.tasks" :key="task.nextFixture.id" :value="task.nextFixture.id">{{ task.nextFixture.exhibition ? '表演赛 · ' : '' }}{{ task.nextFixture.label }} · {{ task.nextFixture.home?.name || '待定' }} vs {{ task.nextFixture.away?.name || '待定' }}</option>
      </ControlSelect></label>
      <div class="streaming-task-preview">
        <div class="streaming-task-teams"><strong>{{ source.data?.nextFixture?.home?.name || '左队待定' }}</strong><span>vs</span><strong>{{ source.data?.nextFixture?.away?.name || '右队待定' }}</strong></div>
        <div class="streaming-task-facts"><span><CalendarDays :size="15" aria-hidden="true" />{{ localTime(source.data?.nextFixture?.scheduledAt, true) }}</span><span>{{ source.data?.mappools[0]?.name ? '图池 · ' + source.data.mappools[0].name : '图池待发布' }}</span></div>
        <p v-if="source.data?.nextFixture?.exhibition">表演赛 · {{ exhibitionFormat(source.data?.stage?.scoringRules) }}<template v-if="source.data?.stage?.playersPerTeam"> · {{ source.data.stage.playersPerTeam }}v{{ source.data.stage.playersPerTeam }}</template></p>
        <p v-else>{{ source.data?.stage?.roundName || source.data?.nextFixture?.roundName || '阶段待核对' }}</p>
        <p v-if="!source.data?.stage?.scoringRules" class="operator-hint">{{ source.data?.nextFixture?.exhibition ? '赛制待核对，可播出并人工记分。' : '赛制待核对，载入后请检查阶段与人数。' }}</p>
        <div class="streaming-task-action"><span v-if="currentTask" class="status-good"><Check :size="16" aria-hidden="true" />本场正在使用</span><button v-else class="operator-primary" :disabled="disabled || pending" @click="act('import')">使用所选直播任务<ArrowRight :size="16" aria-hidden="true" /></button><span class="operator-hint">{{ localTime(source.updatedAt) }} 更新</span></div>
      </div>
      <p v-if="!currentTask" class="operator-hint">换场前请在「管理比赛记录」初始化并存档；载入后核对上场名单。</p>
    </template>
    <p v-else-if="source?.status === 'ready'">目前没有已指派且公开的直播任务。</p>
    <div v-if="source?.status === 'ready' && (source.hasMore || source.afterFixtureId)" class="operator-inline">
      <button v-if="source.afterFixtureId" :disabled="disabled || pending" @click="act('page', { afterFixtureId: null })">返回首批任务</button>
      <button v-if="source.hasMore" :disabled="disabled || pending" @click="act('page', { afterFixtureId: source.tasks?.at(-1)?.nextFixture.id })">查看更多任务</button>
    </div>
    <p v-if="snapshot.session.match.provenance === 'oclr-streaming' && source?.status !== 'ready'" class="operator-hint">本场使用此前确认的资料；授权来源当前不可用。</p>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.streaming-access { display: grid; gap: 14px; }
.streaming-status-row, .streaming-connection, .streaming-task-facts, .streaming-task-facts > span, .streaming-task-action, .streaming-task-action > span { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.streaming-status-row { justify-content: space-between; font-size: 13px; color: var(--op-muted); }
.streaming-status-row .streaming-settings-button { border: 0; background: transparent; font-size: 13px; padding: 4px 8px; }
.streaming-connection-settings .setup-meta { margin-top: 0; }
.streaming-connection-button { align-self: end; }
.streaming-task-preview { border-left: 2px solid var(--op-purple); padding: 4px 0 4px 16px; display: grid; gap: 10px; }
.streaming-task-teams { display: flex; align-items: center; gap: 16px; font-size: 19px; }
.streaming-task-teams strong:first-child { color: #ff9caf; }
.streaming-task-teams strong:last-child { color: #96c1ff; }
.streaming-task-teams > span { font-size: 12px; color: var(--op-muted); }
.streaming-task-facts { column-gap: 18px; color: var(--op-muted); font-size: 13px; }
.streaming-task-action { justify-content: space-between; }
.streaming-access button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.streaming-access svg { flex-shrink: 0; }
</style>
