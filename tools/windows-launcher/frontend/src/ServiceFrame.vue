<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ExternalLink, RefreshCw } from '@lucide/vue';
import { launcher } from './bridge';

const props = defineProps<{ address: string; page: 'control' | 'showcase'; ready: boolean }>();
const emit = defineEmits<{ error: [message: string]; navigate: [page: 'control' | 'showcase'] }>();
const origin = computed(() => new URL(props.address).origin);
const source = computed(() => origin.value + '/' + props.page + '?desktop=1');
const title = computed(() => props.page === 'control' ? '直播控制台' : 'Showcase');
const frame = ref<HTMLIFrameElement>();
const revision = ref(0);
const loaded = ref(false);
const stalled = ref(false);
let timeout: ReturnType<typeof setTimeout> | undefined;

function waitForPage() {
  clearTimeout(timeout);
  loaded.value = false;
  stalled.value = false;
  timeout = setTimeout(() => { stalled.value = true; }, 8000);
}

function reload() {
  waitForPage();
  revision.value++;
}

async function openBrowser(destination: string = props.page, edition = '') {
  try {
    await launcher().OpenBrowser(destination, edition);
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error));
  }
}

function receive(event: MessageEvent) {
  // A nested OBS preview or any other frame cannot request native actions.
  if (event.origin !== origin.value || event.source !== frame.value?.contentWindow) return;
  const data = event.data;
  if (data?.type === 'oclr-desktop-ready') {
    clearTimeout(timeout);
    loaded.value = true;
    stalled.value = false;
  } else if (data?.type === 'oclr-desktop-navigate' && (data.page === 'control' || data.page === 'showcase')) {
    emit('navigate', data.page);
  } else if (props.ready && data?.type === 'oclr-desktop-open' &&
      typeof data.destination === 'string' && typeof data.edition === 'string') {
    void openBrowser(data.destination, data.edition);
  }
}

onMounted(() => {
  window.addEventListener('message', receive);
  waitForPage();
});
onUnmounted(() => {
  clearTimeout(timeout);
  window.removeEventListener('message', receive);
});
</script>

<template>
  <section class="workspace-page" :aria-label="title">
    <div class="workspace-actions">
      <button type="button" :disabled="!ready" @click="reload"><RefreshCw :size="14" />重新加载页面</button>
      <button type="button" :disabled="!ready" @click="openBrowser()"><ExternalLink :size="14" />在浏览器打开</button>
    </div>
    <div class="workspace-view">
      <iframe ref="frame" :key="revision" :src="source" :title="title"
        sandbox="allow-scripts allow-same-origin" allow="clipboard-write" referrerpolicy="origin"
        :class="{ 'workspace-pending': !loaded }" />
      <div v-if="!loaded" class="workspace-message" role="status">
        <p>{{ stalled ? '页面未能载入。请重新加载，或查看服务状态。' : '正在加载' + title + '…' }}</p>
        <button v-if="stalled" type="button" :disabled="!ready" @click="reload">重新加载</button>
      </div>
    </div>
  </section>
</template>
