<script setup lang="ts">
// Fixed decorations stay mounted across live map updates. Only Showcase uses
// this denser field; the common Winner ambient keeps its original motion.
const diamonds = Array.from({ length: 54 }, (_, index) => {
  const duration = 8 + index * 7 % 9;
  return {
    x: 3 + index * 37.7 % 94,
    y: 10 + index * 23.9 % 86,
    size: 6 + index * 5 % 6 * 2,
    rise: 120 + index * 17 % 120,
    duration,
    delay: -(index * 1.73 % duration),
    opacity: .24 + index % 5 * .065,
  };
});
</script>

<template>
  <div class="showcase-ambient" aria-hidden="true">
    <i v-for="(diamond, index) in diamonds" :key="index" class="showcase-diamond"
      :class="{ 'is-solid': index % 4 === 0, 'is-pale': index % 3 === 1 }"
      :style="{ left: `${diamond.x}%`, top: `${diamond.y}%`, width: `${diamond.size}px`, height: `${diamond.size}px`,
        '--rise': `${diamond.rise}px`, '--duration': `${diamond.duration}s`, '--delay': `${diamond.delay}s`, '--opacity': diamond.opacity }"></i>
  </div>
</template>
