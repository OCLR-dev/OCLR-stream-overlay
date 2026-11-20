<script setup lang="ts">
import { useStreamingLogin } from '../streamingLogin';

document.title = 'OCLR · 直播授权';
const edition = new URLSearchParams(location.search).get('desktop-login') || '';
const valid = edition.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition);
const { login, pending, message } = useStreamingLogin(undefined, status => ['ready', 'stale'].includes(status));
</script>

<template>
  <main class="operator">
    <section class="operator-setup" aria-labelledby="desktop-login-title">
      <h1 id="desktop-login-title">OCLR 直播授权</h1>
      <p v-if="valid">授权赛季 {{ edition.toUpperCase() }}。连接后，回到 OCLR 程序选择直播任务。</p>
      <p v-else>赛季无效，请返回 OCLR 程序重新打开授权。</p>
      <button v-if="valid" class="operator-primary" type="button" :disabled="pending" @click="login(edition)">
        {{ pending ? '正在授权…' : '前往 OCLR 授权' }}
      </button>
      <p v-if="message" role="status">{{ message }}</p>
    </section>
  </main>
</template>
