<script setup lang="ts">
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
      <p class="chat-empty">{{ labels[source].placeholder }}</p>
    </div>
  </section>
</template>
