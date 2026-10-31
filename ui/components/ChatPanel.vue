<script setup lang="ts">
import ChatBox from './ChatBox.vue';
</script>

<template>
  <div class="chat-panel" aria-label="比赛聊天和直播间聊天">
    <ChatBox source="match" compact />
    <ChatBox source="stream" compact />
  </div>
</template>
