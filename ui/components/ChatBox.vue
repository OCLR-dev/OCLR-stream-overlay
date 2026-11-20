<script setup lang="ts">
import { computed, inject } from 'vue';
import { overlayKey } from '../useOverlay';
const controller = inject(overlayKey, null);
const view = computed(() => controller?.view.value);
const props = defineProps<{ source: 'match' | 'stream'; compact?: boolean }>();
const labels = {
  match: { title: '比赛聊天', tag: 'MATCH CHAT', placeholder: '比赛聊天内容占位' },
  stream: { title: '直播间 Chat', tag: 'STREAM CHAT', placeholder: '直播间聊天内容占位' }
};
// Room chat has no message ID. Build append-stable keys from the visible fields
// plus an occurrence count, so repeated lines remain distinct and existing
// elements keep their identity when a new line arrives at the end.
const entries = computed(() => {
  const lines = view.value?.shared && props.source === 'match' ? view.value.chat : [];
  const occurrences = new Map<string, number>();
  return lines.map(line => {
    const signature = `${line.timestamp ?? ''}\u0000${line.name ?? ''}\u0000${line.message ?? ''}`;
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    return { line, key: `${signature}\u0000${occurrence}` };
  });
});
</script>

<template>
  <component :is="compact ? 'fieldset' : 'section'" class="chat-box" :class="{ 'chat-box--compact': compact }" :data-chat-source="source" :aria-label="labels[source].title">
    <legend v-if="compact" class="chat-box-legend">{{ labels[source].tag }}</legend>
    <header v-else class="chat-box-header">
      <strong>{{ labels[source].title }}</strong>
      <span>{{ labels[source].tag }}</span>
    </header>
    <div class="chat-box-content">
      <TransitionGroup v-if="view?.shared && source === 'match'" name="chat-line" tag="div" class="chat-lines">
        <p v-if="!entries.length" key="match-chat-empty" class="chat-empty">{{ `等待比赛聊天 · tosu ${view.sourceStatus}` }}</p>
        <p v-for="entry in entries" :key="entry.key" class="match-chat-line">
          <time :title="entry.line.time.title" :aria-label="`${entry.line.time.title} ${entry.line.time.text}`">{{ entry.line.time.text }}</time>
          <span class="match-chat-text"><b :data-team="entry.line.team">{{ entry.line.name || '—' }}</b> {{ entry.line.message }}</span>
        </p>
      </TransitionGroup>
      <p v-else-if="source !== 'stream'" class="chat-empty">{{ view?.shared ? `等待比赛聊天 · tosu ${view.sourceStatus}` : labels[source].placeholder }}</p>
    </div>
  </component>
</template>
