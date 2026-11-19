<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { ObsControl } from '../obsControl';

interface Timeline {
  matchId: string;
  loading: boolean;
  error: string;
  groups: { title: string; markers: { id: string; time: string; label: string }[] }[];
}

const props = defineProps<{ obs: ObsControl; matchId: string }>();
const open = ref(false);
const data = shallowRef<Timeline>();
const feedback = ref('');
const unavailable = ref(false);
const supported = computed(() => !props.obs.unreachable && props.obs.state?.record === 'active');
const timeline = computed(() => data.value?.matchId === props.matchId ? data.value : undefined);
const groups = computed(() => timeline.value?.groups ?? []);
const timelineText = computed(() => groups.value.map(group => [group.title,
  ...group.markers.map(marker => `${marker.time}  ${marker.label}`)].join('\n')).join('\n\n'));
const markingError = computed(() => props.obs.markError ||
  (props.obs.state?.recordingError?.matchId === props.matchId ? props.obs.state.recordingError.message : '') ||
  timeline.value?.error || '');
const copyFallback = ref<HTMLTextAreaElement>();

watch(() => [open.value, props.matchId, props.obs.pending] as const, ([expanded, matchId, pending], previous, cleanup) => {
  if (matchId !== previous?.[1]) {
    data.value = undefined;
    feedback.value = '';
    unavailable.value = false;
    props.obs.markError = '';
  }
  if (!expanded || pending === 'mark-recording') return;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const refresh = async () => {
    try {
      const response = await fetch('/api/obs/recording', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
      if (!response.ok) throw new Error();
      const next = await response.json();
      if (!controller.signal.aborted) {
        data.value = next;
        unavailable.value = false;
      }
    } catch {
      if (!controller.signal.aborted) unavailable.value = true;
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(refresh, 2000);
    }
  };
  void refresh();
  cleanup(() => { controller.abort(); clearTimeout(timer); });
});

async function mark() {
  feedback.value = '';
  const matchId = props.matchId;
  if (await props.obs.act('mark-recording', { matchId }) && props.matchId === matchId) feedback.value = '已标记精彩时刻';
}

async function copy() {
  feedback.value = '';
  try {
    await navigator.clipboard.writeText(timelineText.value);
    feedback.value = '已复制时间轴';
  } catch {
    copyFallback.value?.focus();
    copyFallback.value?.select();
    feedback.value = '请复制已选中的时间轴';
  }
}
</script>

<template>
  <div class="operator-recording">
    <div class="operator-inline">
      <button v-if="supported" type="button" :disabled="!!obs.pending" @click="mark">标记精彩时刻</button>
      <span v-if="feedback" role="status">{{ feedback }}</span>
    </div>
    <p v-if="markingError" class="operator-error" role="alert">{{ markingError }}</p>
    <details @toggle="open = ($event.target as HTMLDetailsElement).open">
      <summary>录像打点</summary>
      <template v-if="open">
        <p v-if="unavailable" class="operator-error" role="alert">暂时读不到录像打点</p>
        <p v-if="(!timeline && !unavailable) || timeline?.loading" role="status">正在读取录像打点</p>
        <template v-else-if="groups.length">
          <textarea ref="copyFallback" :value="timelineText" readonly aria-label="录像时间轴" rows="5"></textarea>
          <button type="button" @click="copy">复制时间轴</button>
        </template>
        <p v-else-if="timeline && !timeline.error">本场暂无打点</p>
      </template>
    </details>
  </div>
</template>
