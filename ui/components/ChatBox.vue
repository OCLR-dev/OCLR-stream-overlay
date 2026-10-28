<script setup lang="ts">
import { useOverlay } from '../useOverlay';
const { view } = useOverlay();
defineProps<{ source: 'match' | 'stream' }>();
const labels = {
  match: { title: '比赛聊天', tag: 'MATCH CHAT', placeholder: '比赛聊天内容占位' },
  stream: { title: '直播间 Chat', tag: 'STREAM CHAT', placeholder: '直播间聊天内容占位' }
};
</script>

<template>
  <section class="chat-box" :data-chat-source="source" :aria-label="labels[source].title">
    <header class="chat-box-header">
      <strong>{{ labels[source].title }}</strong>
      <span>{{ labels[source].tag }}</span>
    </header>
    <div class="chat-box-content">
      <template v-if="view.shared && source === 'match' && view.chat.length">
        <p v-for="(line, index) in view.chat" :key="index" class="match-chat-line"><b>{{ line.name || '—' }}</b> {{ line.message }}</p>
      </template>
      <p v-else class="chat-empty">{{ view.shared ? source === 'stream' ? '固定直播间 Chat · 等待 OBS 源叠放' : `等待比赛聊天 · tosu ${view.sourceStatus}` : labels[source].placeholder }}</p>
    </div>
  </section>
</template>
