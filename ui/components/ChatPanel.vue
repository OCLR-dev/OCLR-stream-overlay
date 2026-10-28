<script setup lang="ts">
import ChatBox from './ChatBox.vue';
</script>

<template>
  <div class="chat-panel">
    <div class="chat-heading">
      <span class="footer-kicker">场间互动</span>
      <strong>聊天</strong>
    </div>
    <div class="chat-messages" aria-label="比赛聊天和直播间聊天">
      <ChatBox source="match" />
      <ChatBox source="stream" />
    </div>
  </div>
</template>
