<script setup lang="ts">
// Fixed decorative paths, independent of scores, SSE and scene lifecycle.
const diamondSeeds = [
  { x: 43, y: 67, size: 12, dx: 150, dy: -110, duration: 16, delay: -5, opacity: 0.62, solid: false },
  { x: 53, y: 77, size: 8, dx: 170, dy: -125, duration: 18, delay: -13, opacity: 0.65, solid: true },
  { x: 2, y: 67, size: 16, dx: 130, dy: -100, duration: 20, delay: -8, opacity: 0.42, solid: false },
  { x: 94, y: 57, size: 10, dx: 100, dy: -85, duration: 14, delay: -3, opacity: 0.65, solid: false },
  { x: 69, y: 52, size: 16, dx: 150, dy: -115, duration: 20, delay: -14, opacity: 0.48, solid: false },
  { x: 81, y: 73, size: 6, dx: 170, dy: -130, duration: 12, delay: -5, opacity: 0.72, solid: true },
  { x: 58, y: 58, size: 10, dx: 160, dy: -120, duration: 16, delay: -11, opacity: 0.5, solid: true },
  { x: 35, y: 88, size: 14, dx: 125, dy: -90, duration: 18, delay: -2, opacity: 0.5, solid: false },
  { x: 76, y: 88, size: 8, dx: 180, dy: -130, duration: 14, delay: -10, opacity: 0.7, solid: true },
  { x: 86, y: 42, size: 12, dx: 130, dy: -100, duration: 20, delay: -17, opacity: 0.5, solid: false },
  { x: 4, y: 13, size: 10, dx: 120, dy: -65, duration: 18, delay: -7, opacity: 0.5, solid: false },
  { x: 91, y: 13, size: 6, dx: 110, dy: -80, duration: 16, delay: -12, opacity: 0.65, solid: true },
  { x: 28, y: 22, size: 8, dx: 160, dy: -100, duration: 14, delay: -4, opacity: 0.55, solid: true },
  { x: 57, y: 27, size: 14, dx: 130, dy: -95, duration: 20, delay: -11, opacity: 0.42, solid: false },
  { x: 17, y: 43, size: 12, dx: 145, dy: -110, duration: 18, delay: -15, opacity: 0.5, solid: false },
  { x: 7, y: 91, size: 8, dx: 170, dy: -120, duration: 16, delay: -9, opacity: 0.6, solid: true },
  { x: 47, y: 96, size: 10, dx: 160, dy: -100, duration: 14, delay: -2, opacity: 0.55, solid: false },
  { x: 91, y: 92, size: 16, dx: 120, dy: -95, duration: 20, delay: -6, opacity: 0.45, solid: false },
];
const diamonds = [
  ...diamondSeeds,
  ...diamondSeeds.map((diamond, index) => ({
    ...diamond,
    x: 3 + (diamond.x + 31) % 91,
    y: 8 + (diamond.y + 39) % 88,
    delay: diamond.delay - diamond.duration * .47,
    solid: index % 3 === 0 ? !diamond.solid : diamond.solid,
  })),
].map(diamond => ({ ...diamond, duration: diamond.duration / 2, delay: diamond.delay / 2 }));
</script>
<template>
  <div class="broadcast-ambient" aria-hidden="true">
    <i v-for="(diamond, index) in diamonds" :key="index" class="ambient-diamond"
      :class="{ 'is-solid': diamond.solid, 'is-pale': index % 3 === 1 }"
      :style="{ left: `${diamond.x}%`, top: `${diamond.y}%`, width: `${diamond.size}px`, height: `${diamond.size}px`,
        '--dx': `${diamond.dx}px`, '--dy': `${diamond.dy}px`, '--duration': `${diamond.duration}s`, '--delay': `${diamond.delay}s`, '--opacity': diamond.opacity }"></i>
  </div>
</template>
