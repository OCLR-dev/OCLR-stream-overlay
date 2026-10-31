<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Envelope } from '../session';
const props = defineProps<{ snapshot: Envelope; disabled: boolean }>();
const edition = ref('s11');
const localOrigin = location.origin;
const tokenInput = ref<HTMLInputElement>();
const pending = ref(false);
const message = ref('');
const source = computed(() => props.snapshot.live.streaming);
const validEdition = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition.value) && edition.value.length <= 80);
const accessUrl = computed(() => `https://oclr.org/streaming/${validEdition.value ? edition.value : 's11'}`);
const status = computed(() => ({ ready: '已连接，资料自动更新', connecting: '正在连接', stale: '连接中断，本场记录保留，资料待更新', unauthorized: '授权已失效，请重新取得授权', error: '无法读取此赛季或场次，请核对授权', disconnected: '尚未连接' }[source.value?.status || 'disconnected']));
async function act(action: string) {
  if (pending.value) return;
  pending.value = true; message.value = '';
  const input = tokenInput.value;
  // Read once from the password control; never retain the credential in reactive state.
  const request = action === 'connect' ? { action, edition: edition.value, token: input?.value || '' } :
    { action, id: crypto.randomUUID(), version: props.snapshot.session.version, fixtureId: source.value?.data?.nextFixture?.id };
  if (input) input.value = '';
  try {
    const response = await fetch('/api/streaming', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || '操作失败，请重试');
    message.value = action === 'import' ? '已使用本场资料；请核对上场名单与阶段' : action === 'disconnect' ? '已断开，本场记录保留；如需撤销凭证，请到授权页操作' : '已提交连接，请查看连接状态';
  } catch (error) { message.value = error instanceof Error ? error.message : '连接失败，请重试'; }
  finally { pending.value = false; }
}
</script>
<template>
  <details class="operator-import">
    <summary>连接直播授权 · 下一场</summary>
    <p>在网站登录并取得本赛季直播授权。凭证只留在本机服务内存，重启后需重新连接。</p>
    <div class="setup-meta">
      <label>授权赛季<input v-model="edition" maxlength="80" :disabled="pending" autocomplete="off"></label>
      <a :href="accessUrl" target="_blank" rel="noopener noreferrer">打开直播授权页</a>
      <label>一次性授权凭证<input ref="tokenInput" type="password" autocomplete="off" spellcheck="false" maxlength="100" :disabled="pending"></label>
    </div>
    <p>授权页请选择当前控制台的网址：{{ localOrigin }}。连接不会向网站写入比赛资料。</p>
    <div class="operator-actions">
      <button :disabled="disabled || pending || !validEdition" @click="act('connect')">连接授权</button>
      <button :disabled="disabled || pending" @click="act('disconnect')">断开连接</button>
    </div>
    <p role="status">{{ status }} · {{ source?.updatedAt || '尚无成功读取' }}</p>
    <template v-if="source?.status === 'ready' && source.data?.nextFixture">
      <p><strong>{{ source.data.nextFixture.label }}</strong> · {{ source.data.stage?.roundName }}</p>
      <p>{{ source.data.nextFixture.home?.name || '队伍待定' }} vs {{ source.data.nextFixture.away?.name || '队伍待定' }}</p>
      <p>{{ source.data.nextFixture.scheduledAt }} · {{ source.data.mappools.length ? source.data.mappools[0]?.name : '尚无公开图池，可稍后人工设置' }}</p>
      <p>先初始化并存档已有比赛，再使用下一场。网站未提供上场名单，请核对后录入。</p>
      <button :disabled="disabled || pending" @click="act('import')">使用这场对阵</button>
    </template>
    <p v-else-if="source?.status === 'ready'">目前没有已指派且公开的下一场比赛。</p>
    <p v-if="snapshot.session.match.provenance === 'oclr-streaming' && source?.status !== 'ready'">本场使用此前确认的资料；授权来源当前不可用，比赛记录保留。</p>
    <p role="status">{{ message }}</p>
  </details>
</template>
