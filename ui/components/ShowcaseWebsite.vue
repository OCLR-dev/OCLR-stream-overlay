<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import type { WebsitePool, WebsitePoolSelection } from '../showcase';
import { streamingRequest, useStreamingLogin } from '../streamingLogin';

const props = defineProps<{
  canImport: boolean;
  importPool: (selection: WebsitePoolSelection) => Promise<boolean>;
}>();
type Connection = { edition: string; connection: string };
const access = shallowRef<Connection | null>(null);
const edition = ref('s11');
const tokenInput = ref<HTMLInputElement>();
const pools = shallowRef<WebsitePool[]>([]);
const selected = ref('');
const preview = shallowRef<WebsitePool | null>(null);
const loading = ref<'list' | 'preview' | null>(null);
const importing = ref(false);
const status = ref('');
const validEdition = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition.value) && edition.value.length <= 80);
const { pending, message, login } = useStreamingLogin(() => { void checkConnection(true); }, value => ['ready', 'stale'].includes(value));
let timer: ReturnType<typeof setInterval>;
let activeCheck = 0;
let checkRevision = 0;
let disposed = false;
let revision = 0;

function resetSources() {
  revision++;
  pools.value = [];
  preview.value = null;
  loading.value = null;
}

async function checkConnection(force = false) {
  if ((!force && activeCheck) || disposed) return;
  const check = ++checkRevision;
  activeCheck = check;
  try {
    const response = await fetch('/api/showcase/website', { cache: 'no-store', signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error();
    const value = await response.json();
    if (disposed || activeCheck !== check || (value.edition === (access.value?.edition ?? null) && value.connection === (access.value?.connection ?? null))) return;
    access.value = value.edition ? value : null;
    selected.value = '';
    resetSources();
    status.value = '';
    if (access.value) {
      edition.value = access.value.edition;
      void refresh();
    }
  } catch {
    if (!disposed && activeCheck === check && access.value) {
      access.value = null;
      selected.value = '';
      resetSources();
      status.value = '暂时无法连接本机图池服务。';
    }
  } finally { if (activeCheck === check) activeCheck = 0; }
}

async function request(connection: Connection, action: 'list' | 'preview', pool?: WebsitePool) {
  const response = await fetch('/api/showcase/website', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ ...connection, action, ...(pool ? { poolId: pool.id, version: pool.version } : {}) }),
    signal: AbortSignal.timeout(9500),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || '暂时无法读取网站图池，请稍后重试。');
  return data;
}

async function refresh() {
  if (!access.value) return;
  const requestRevision = ++revision;
  preview.value = null;
  loading.value = 'list';
  status.value = '';
  try {
    const result = await request(access.value, 'list');
    if (requestRevision !== revision) return;
    pools.value = result.pools;
    if (pools.value.some(pool => pool.id === selected.value)) {
      void selectPool();
    } else {
      selected.value = '';
      if (!pools.value.length) status.value = '此账号目前没有获准演示的图池。';
    }
  } catch (error) {
    if (requestRevision !== revision) return;
    resetSources();
    status.value = error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '暂时无法读取网站图池，请稍后重试。';
  } finally { if (requestRevision === revision) loading.value = null; }
}

async function selectPool() {
  const requestRevision = ++revision;
  preview.value = null;
  status.value = '';
  const pool = pools.value.find(item => item.id === selected.value);
  if (!pool || !access.value) { loading.value = null; return; }
  loading.value = 'preview';
  try {
    const result = await request(access.value, 'preview', pool);
    if (requestRevision === revision) preview.value = result.pool;
  } catch (error) {
    if (requestRevision !== revision) return;
    resetSources();
    status.value = error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '无法预览图池，请刷新列表。';
  } finally { if (requestRevision === revision) loading.value = null; }
}

async function importSelected() {
  if (!access.value || !preview.value || !props.canImport || importing.value) return;
  const requestRevision = revision;
  const { id, version, name } = preview.value;
  importing.value = true;
  try {
    const ok = await props.importPool({ ...access.value, poolId: id, version });
    if (requestRevision !== revision) return;
    if (ok) status.value = `已导入 ${name}`;
    else { resetSources(); status.value = '请刷新列表后重新确认。'; }
  } finally { importing.value = false; }
}

async function changeConnection(action: 'connect' | 'disconnect') {
  if (pending.value) return;
  pending.value = true;
  message.value = '';
  const token = action === 'connect' ? tokenInput.value?.value || '' : '';
  if (tokenInput.value) tokenInput.value.value = '';
  try {
    await streamingRequest(action === 'connect' ? { action, edition: edition.value, token } : { action });
    await checkConnection(true);
    if (action === 'connect' && !access.value) message.value = '连接未完成，请核对赛季与凭证后重试。';
  } catch {
    message.value = '连接未完成，请核对赛季与凭证后重试。';
  } finally { pending.value = false; }
}

onMounted(() => { void checkConnection(); timer = setInterval(() => { void checkConnection(); }, 3000); });
onUnmounted(() => { disposed = true; revision++; clearInterval(timer); });
</script>

<template>
  <section class="showcase-website" aria-labelledby="showcase-website-heading">
    <h3 id="showcase-website-heading">从 OCLR 网站导入</h3>
    <template v-if="access">
      <div class="showcase-website-actions">
        <strong>{{ access.edition.toUpperCase() }} · 已连接</strong>
        <button type="button" :disabled="!!loading || importing" @click="refresh">刷新图池</button>
        <button type="button" :disabled="pending || importing" @click="changeConnection('disconnect')">断开连接</button>
      </div>
      <label v-if="pools.length" class="showcase-website-field">获准演示的图池
        <select v-model="selected" :disabled="loading === 'list' || importing" @change="selectPool">
          <option value="">选择图池</option>
          <option v-for="pool in pools" :key="pool.id" :value="pool.id">{{ pool.name }} · {{ pool.round.name }}</option>
        </select>
      </label>
      <div v-if="preview" class="showcase-website-preview">
        <strong>{{ preview.name }}</strong>
        <span>{{ preview.round.name }} · {{ preview.entryCount }} 张谱面</span>
        <button type="button" class="showcase-website-import" :disabled="!canImport || importing || !!loading" @click="importSelected">
          {{ importing ? '正在核对并导入…' : '导入到 Showcase' }}
        </button>
      </div>
    </template>
    <template v-else>
      <label class="showcase-website-field">授权赛季
        <input v-model="edition" maxlength="80" autocomplete="off" :disabled="pending">
      </label>
      <button type="button" :disabled="pending || !validEdition" @click="login(edition)">{{ pending ? '正在连接…' : '登录 OCLR' }}</button>
      <details>
        <summary>手动复制授权（备用）</summary>
        <a :href="`https://oclr.org/streaming/${validEdition ? edition : 's11'}`" data-desktop-link="streaming-page" :data-edition="validEdition ? edition : 's11'" target="_blank" rel="noopener noreferrer">打开直播授权页</a>
        <label class="showcase-website-field">一次性授权凭证
          <input ref="tokenInput" type="password" autocomplete="off" spellcheck="false" maxlength="100" :disabled="pending">
        </label>
        <button type="button" :disabled="pending || !validEdition" @click="changeConnection('connect')">使用复制的授权连接</button>
      </details>
    </template>
    <p v-if="loading || status || message" class="showcase-help" role="status">{{ loading === 'list' ? '正在读取图池…' : loading === 'preview' ? '正在核对图池…' : status || message }}</p>
  </section>
</template>
