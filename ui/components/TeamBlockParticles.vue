<script setup lang="ts">
// Paired with the header's diffuse field, these white motes sit inside the
// team colour blocks themselves. Fixed seeds keep the output deterministic.
const particles = Array.from({ length: 30 }, (_, index) => ({
  x: 4 + index * 37 % 92,
  y: 8 + index * 53 % 84,
  dx: index * 29 % 90 - 45,
  dy: -(20 + index * 31 % 55),
  size: 2 + index % 3 * .8,
  opacity: .22 + index % 4 * .12,
  duration: 10 + index * 7 % 9,
  delay: -(index * 11 % 19),
}));
</script>

<template>
  <div class="team-particles" aria-hidden="true">
    <span v-for="(particle, index) in particles" :key="index" class="team-particle"
      :style="{ left: `${particle.x}%`, top: `${particle.y}%`, '--dx': `${particle.dx}px`, '--dy': `${particle.dy}px`,
        '--size': `${particle.size}px`, '--opacity': particle.opacity, '--duration': `${particle.duration}s`,
        '--delay': `${particle.delay}s` }"></span>
  </div>
</template>
