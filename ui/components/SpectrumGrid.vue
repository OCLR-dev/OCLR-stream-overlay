<script setup lang="ts">
// Gliding light probes sit on the existing straight 48px grid. Fixed decorative
// segments use CSS only: no audio capture, match state, timers or random resets.
const segments = Array.from({ length: 22 }, (_, row) => [
  { axis: 'horizontal', column: (row * 7 + 3) % 36, row, length: (2 + row % 3) * 48, travel: (3 + row % 2) * 48 },
  { axis: 'horizontal', column: (row * 11 + 19) % 36, row, length: (2 + (row + 1) % 3) * 48, travel: (2 + (row + 1) % 3) * 48 },
  { axis: 'vertical', column: (row * 13 + 9) % 40, row: (row * 7 + 2) % 19, length: (2 + (row + 2) % 3) * 48, travel: (2 + row % 3) * 48 },
]).flat().map((segment, index) => ({
  ...segment,
  // The horizontal CSS grid starts at the bottom of the 1080px canvas:
  // 1080 % 48 = 24. Centering a 1.5px stroke on the 1px base line keeps probes crisp.
  x: segment.column * 48 - (segment.axis === 'vertical' ? 0.25 : 0),
  y: segment.row * 48 + (segment.axis === 'horizontal' ? 22.75 : 23),
  duration: index % 4 === 0 ? 7.8 : index % 3 === 0 ? 6.2 : 5.0,
  delay: -(index * 5 % 24) * 0.35,
}));
</script>

<template>
  <svg class="spectrum-grid" viewBox="0 0 1920 1080" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="spectrumProbeH" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#b99be5" stop-opacity="0" />
        <stop offset="28%" stop-color="#c4a6f2" stop-opacity="0.52" />
        <stop offset="62%" stop-color="#f3e8ff" stop-opacity="0.95" />
        <stop offset="86%" stop-color="#c4a6f2" stop-opacity="0.45" />
        <stop offset="100%" stop-color="#b99be5" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="spectrumProbeV" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#b99be5" stop-opacity="0" />
        <stop offset="28%" stop-color="#c4a6f2" stop-opacity="0.52" />
        <stop offset="62%" stop-color="#f3e8ff" stop-opacity="0.95" />
        <stop offset="86%" stop-color="#c4a6f2" stop-opacity="0.45" />
        <stop offset="100%" stop-color="#b99be5" stop-opacity="0" />
      </linearGradient>
    </defs>
    <g v-for="(segment, index) in segments" :key="index" :transform="`translate(${segment.x} ${segment.y})`">
      <rect class="spectrum-segment" :data-axis="segment.axis" x="0" y="0"
        :width="segment.axis === 'horizontal' ? segment.length : 1.5"
        :height="segment.axis === 'vertical' ? segment.length : 1.5"
        :fill="segment.axis === 'horizontal' ? 'url(#spectrumProbeH)' : 'url(#spectrumProbeV)'"
        :style="{ '--spectrum-duration': `${segment.duration}s`, '--spectrum-delay': `${segment.delay}s`, '--spectrum-travel': `${segment.travel}px` }" />
    </g>
  </svg>
</template>
