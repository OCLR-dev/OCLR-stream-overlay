<script setup lang="ts">
// Crisp 45-degree micro diamond crystals inside the team colour banners.
// Fixed seeds keep the output deterministic with zero JS timers.
const particles = Array.from({ length: 28 }, (_, index) => ({
  x: 4 + (index * 37) % 92,
  y: 12 + (index * 53) % 80,
  dx: (index * 29) % 72 - 36,
  dy: -(24 + (index * 31) % 52),
  size: 2.6 + (index % 3) * 1.1,
  opacity: 0.22 + (index % 4) * 0.11,
  duration: 10 + (index * 7) % 9,
  delay: -(index * 11 % 19),
  hollow: index % 3 === 0,
}));
</script>

<template>
  <div class="team-particles" aria-hidden="true">
    <span v-for="(particle, index) in particles" :key="index" class="team-particle" :class="{ 'is-hollow': particle.hollow }"
      :style="{ left: `${particle.x}%`, top: `${particle.y}%`, '--dx': `${particle.dx}px`, '--dy': `${particle.dy}px`,
        '--size': `${particle.size}px`, '--opacity': particle.opacity, '--duration': `${particle.duration}s`,
        '--delay': `${particle.delay}s` }"></span>
  </div>
</template>
