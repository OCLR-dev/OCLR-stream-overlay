<script setup lang="ts">
import { useOverlay } from '../useOverlay';
const { view } = useOverlay();
defineProps<{ source: 'match' | 'stream'; compact?: boolean }>();
const labels = {
  match: { title: '比赛聊天', tag: 'MATCH CHAT', placeholder: '比赛聊天内容占位' },
  stream: { title: '直播间 Chat', tag: 'STREAM CHAT', placeholder: '直播间聊天内容占位' }
};
</script>

<template>
  <component :is="compact ? 'fieldset' : 'section'" class="chat-box" :class="{ 'chat-box--compact': compact }" :data-chat-source="source" :aria-label="labels[source].title">
    <legend v-if="compact" class="chat-box-legend">{{ labels[source].tag }}</legend>
    <header v-else class="chat-box-header">
      <strong>{{ labels[source].title }}</strong>
      <span>{{ labels[source].tag }}</span>
    </header>
    <div class="chat-box-content">
      <template v-if="view.shared && source === 'match' && view.chat.length">
        <p v-for="(line, index) in view.chat" :key="index" class="match-chat-line">
          <time :title="line.time.title" :aria-label="`${line.time.title} ${line.time.text}`">{{ line.time.text }}</time>
          <span class="match-chat-text"><b :data-team="line.team">{{ line.name || '—' }}</b> {{ line.message }}</span>
        </p>
      </template>
      <p v-else-if="source !== 'stream'" class="chat-empty">{{ view.shared ? `等待比赛聊天 · tosu ${view.sourceStatus}` : labels[source].placeholder }}</p>
    </div>
  </component>
</template>
