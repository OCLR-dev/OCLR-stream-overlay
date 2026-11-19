<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { LayoutDashboard, Settings2, ScrollText, Info, ExternalLink, Copy, Play, FolderOpen, RefreshCw, Power, Radio, ChevronRight, Monitor } from '@lucide/vue';
import { launcher } from './bridge';
import type { LauncherState } from './bridge';

const pages = [{ id: 'overview', label: '概览', icon: LayoutDashboard }, { id: 'settings', label: '设置', icon: Settings2 }, { id: 'logs', label: '日志', icon: ScrollText }, { id: 'about', label: '关于', icon: Info }];
const page = ref('overview');
const state = ref<LauncherState>({ status: 'starting', notice: '', port: '', address: '', build: '', busy: true, tosuPath: '', osuPath: '', tosuStatus: '正在检查', tosuPort: '', canStartTosu: false });
const port = ref('');
const portDirty = ref(false);
const busy = ref(false);
const feedback = ref('');
const error = ref('');
const log = ref('');
const logElement = ref<HTMLElement>();
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const locked = computed(() => busy.value || state.value.busy);
const running = computed(() => ['ready', 'waiting'].includes(state.value.status));
const statusLabel = computed(() => ({ starting: '正在启动服务', ready: '直播服务已就绪', waiting: '等待服务响应', stopped: '服务已停止', failed: '服务启动失败', stopping: '正在保存比赛' }[state.value.status] || '正在检查服务'));
const title = computed(() => pages.find(item => item.id === page.value)?.label);
async function refresh() {
  const next = await launcher().Snapshot();
  if (!portDirty.value) port.value = next.port;
  state.value = next;
  if (page.value === 'logs') {
    const element = logElement.value;
    const follow = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 30;
    log.value = await launcher().LogPreview();
    if (follow) requestAnimationFrame(() => { if (logElement.value) logElement.value.scrollTop = logElement.value.scrollHeight; });
  }
}
async function poll() {
  try { await refresh(); } catch { error.value = '无法读取启动器状态，请稍后重试。'; }
  if (!disposed) timer = setTimeout(poll, state.value.status === 'starting' ? 100 : 1000);
}
async function act(action: () => Promise<unknown>, success = '') {
  if (locked.value) return;
  busy.value = true; error.value = ''; feedback.value = '';
  try { await action(); feedback.value = success; await refresh(); }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}
async function restart() {
  await act(async () => { await launcher().Restart(port.value); const next = await launcher().Snapshot(); if (next.port === String(Number(port.value))) portDirty.value = false; });
}
onMounted(poll);
onUnmounted(() => { disposed = true; clearTimeout(timer); });
</script>

<template>
  <div class="shell">
    <aside>
      <div class="brand"><span class="brand-mark"><Radio :size="23" /></span><div><strong>OCLR</strong><small>直播工作台</small></div></div>
      <nav aria-label="启动器导航"><button v-for="item in pages" :key="item.id" :class="{ selected: page === item.id }" :aria-current="page === item.id ? 'page' : undefined" @click="page = item.id"><component :is="item.icon" :size="18" />{{ item.label }}<ChevronRight v-if="page === item.id" :size="14" class="chevron" /></button></nav>
      <div class="aside-bottom"><span class="local-label"><i :class="state.status" />本机直播服务</span><button class="exit" :disabled="locked" @click="act(() => launcher().Quit())"><Power :size="16" />退出服务</button></div>
    </aside>
    <main>
      <header><div><span class="eyebrow">OCLR STREAM OVERLAY</span><h1>{{ title }}</h1></div><span class="badge"><Monitor :size="14" />Windows</span></header>
      <div class="content">
        <div v-if="error" class="notice error" role="alert">{{ error }}</div>
        <div v-if="feedback" class="notice success" role="status">{{ feedback }}</div>
        <section v-if="page === 'overview'" aria-label="服务概览">
          <div class="hero"><div class="status-line"><i :class="state.status" /><span>{{ statusLabel }}</span></div><h2>准备好，让比赛上场。</h2><p>{{ state.notice || '正在准备本机直播服务，请稍候。' }}</p><div class="actions"><button class="primary" :disabled="locked || !running" @click="act(() => launcher().OpenControl())">打开直播控制台<ExternalLink :size="17" /></button><button :disabled="locked || !state.address" @click="act(() => launcher().CopyAddresses(false), 'OBS 地址已复制。')"><Copy :size="16" />复制 OBS 地址</button></div><code class="address">{{ state.address ? state.address + '/overlay' : '正在准备画面地址…' }}</code><button v-if="['failed', 'stopped'].includes(state.status)" class="retry" :disabled="locked" @click="act(() => launcher().Restart(state.port))"><RefreshCw :size="16" />重新启动服务</button></div>
          <h3 class="section-heading">比赛工具<span>建议先打开 osu!Tourney，再打开 tosu</span></h3>
          <div class="tool-grid"><article class="card"><div class="tool-top"><span class="tool-icon">t</span><h3>tosu</h3></div><p>{{ state.tosuStatus }}</p><small>{{ state.tosuPort }}</small><button v-if="!state.tosuPath" @click="page = 'settings'">选择应用程序<ChevronRight :size="15" /></button><button v-else :disabled="locked || !state.canStartTosu" @click="act(() => launcher().StartTosu())"><Play :size="15" />打开 tosu</button></article><article class="card"><div class="tool-top"><span class="tool-icon pink">o!</span><h3>osu!Tourney</h3></div><p>{{ state.osuPath ? '已选择 osu!stable' : '先选择 osu!stable' }}</p><small>使用控制台当前授权赛季</small><button v-if="!state.osuPath" @click="page = 'settings'">选择应用程序<ChevronRight :size="15" /></button><button v-else :disabled="locked || !running" @click="act(() => launcher().Tourney(true))"><Play :size="15" />打开 osu!Tourney</button></article></div>
        </section>
        <section v-else-if="page === 'settings'" aria-label="启动器设置" class="stack">
          <article class="card"><h2>直播服务</h2><p>修改端口后重新启动。比赛记录会保留，OBS 输出会短暂中断。</p><label for="port">本机端口</label><div class="input-row"><input id="port" v-model="port" inputmode="numeric" maxlength="5" :disabled="locked" @input="portDirty = true" /><button :disabled="locked" @click="restart"><RefreshCw :size="16" />重新启动</button></div><div class="address-row"><code>{{ state.address }}/overlay</code><button :disabled="locked" @click="act(() => launcher().CopyAddresses(true), '控制台、OBS 与 Showcase 地址已复制。')"><Copy :size="15" />复制全部地址</button></div></article>
          <article class="card"><h2>比赛工具</h2><div class="setting-tool"><label>tosu 应用程序</label><p class="path">{{ state.tosuPath || '尚未选择 tosu.exe' }}</p><button :disabled="locked" @click="act(() => launcher().ChooseTool('tosu'))"><FolderOpen :size="16" />选择 tosu.exe</button></div><div class="setting-tool"><label>osu!stable 应用程序</label><p class="path">{{ state.osuPath || '尚未选择 osu!.exe' }}</p><div class="actions"><button :disabled="locked" @click="act(() => launcher().ChooseTool('osu'))"><FolderOpen :size="16" />选择 osu!.exe</button><button :disabled="locked || !running || !state.osuPath" @click="act(() => launcher().Tourney(false))">生成比赛配置</button></div></div></article>
        </section>
        <section v-else-if="page === 'logs'" class="logs-page" aria-label="本机日志"><div class="section-heading"><h2>最近运行记录</h2><button :disabled="locked" @click="act(() => launcher().OpenLog())"><ExternalLink :size="15" />打开完整日志</button></div><p>遇到启动或连接问题时，可在这里查看原因。</p><pre ref="logElement" tabindex="0" aria-label="最近日志">{{ log || '暂无日志记录。' }}</pre></section>
        <section v-else class="stack" aria-label="关于 OCLR"><article class="card about"><span class="brand-mark large"><Radio :size="35" /></span><h2>OCLR 直播工作台</h2><p>为社区赛事准备的本机直播服务。</p><p>开源许可 · MIT License<br>© 2026 OCLR Dev Team</p><p>直播控制台在浏览器打开，观众画面由 OBS 浏览器源显示。</p><button :disabled="locked" @click="act(() => launcher().OpenProject())">项目主页<ExternalLink :size="16" /></button></article><article class="card"><h3>构建标识</h3><code class="build">{{ state.build || '开发版本' }}</code><small>启动界面：Wails · Vue<br>比赛服务：Node.js</small></article></section>
      </div>
      <footer role="status"><i :class="state.status" /><span>{{ page === 'overview' ? statusLabel : (state.notice || statusLabel) }}</span><span v-if="locked" class="working">处理中…</span></footer>
    </main>
  </div>
</template>
