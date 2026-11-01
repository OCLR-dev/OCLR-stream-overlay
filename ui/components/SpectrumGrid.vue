<script setup lang="ts">
// Short accents sit on the existing straight 48px grid. These fixed decorative
// segments use CSS only: no audio capture, match state, timers or random resets.
const segments = Array.from({ length: 22 }, (_, row) => [
  { axis: 'horizontal', column: (row * 7 + 3) % 37, row, length: (1 + row % 3) * 48 },
  { axis: 'horizontal', column: (row * 11 + 19) % 37, row, length: (1 + (row + 1) % 3) * 48 },
  { axis: 'vertical', column: (row * 13 + 9) % 40, row: (row * 7 + 2) % 20, length: (1 + (row + 2) % 3) * 48 },
]).flat().map((segment, index) => ({
  ...segment,
  // The horizontal CSS grid starts at the bottom of the 1080px canvas:
  // 1080 % 48 = 24. Half-pixel centers keep the accent on the 1px base line.
  x: segment.column * 48 + .5,
  y: segment.row * 48 + 23.5,
  duration: index % 4 === 0 ? 7.2 : 4.8,
  delay: -(index * 5 % 24) * .3,
}));
</script>

<template>
  <svg class="spectrum-grid" viewBox="0 0 1920 1080" aria-hidden="true" focusable="false">
    <g v-for="(segment, index) in segments" :key="index" :transform="`translate(${segment.x} ${segment.y})`">
      <line class="spectrum-segment" :data-axis="segment.axis" x1="0" y1="0"
        :x2="segment.axis === 'horizontal' ? segment.length : 0" :y2="segment.axis === 'vertical' ? segment.length : 0"
        vector-effect="non-scaling-stroke"
        :style="{ '--spectrum-duration': `${segment.duration}s`, '--spectrum-delay': `${segment.delay}s` }" />
    </g>
  </svg>
</template>
