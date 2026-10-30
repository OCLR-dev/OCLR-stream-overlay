<script setup lang="ts">
defineProps<{ team: 'a' | 'b' }>();
</script>

<template>
  <figure class="team-flag-preview" :aria-label="`${team === 'a' ? '左' : '右'}队队旗占位示例`">
    <svg viewBox="0 0 120 72" role="img" aria-label="示例队旗，非实际队伍图片">
      <template v-if="team === 'a'">
        <path fill="#f2e9da" d="M0 0h120v72H0z" />
        <path fill="#204d49" d="M0 0h45l48 72H0z" />
        <path fill="#d5a649" d="m78 14 5 14 15 1-12 9 4 15-12-9-12 9 4-15-12-9 15-1z" />
        <path fill="#f2e9da" d="m16 18 23 18-23 18 8-18z" />
      </template>
      <template v-else>
        <path fill="#191e3d" d="M0 0h120v72H0z" />
        <path fill="#e8b46f" d="m0 54 120-36v18L0 72z" />
        <circle cx="70" cy="27" r="17" fill="#f5eee0" />
        <circle cx="78" cy="21" r="16" fill="#191e3d" />
        <path fill="#f5eee0" d="m29 13 2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
      </template>
    </svg>
    <figcaption>队旗占位</figcaption>
  </figure>
</template>
