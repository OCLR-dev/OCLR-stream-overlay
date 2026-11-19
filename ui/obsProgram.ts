import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { ObsControl } from './obsControl';

const streamLabels = { off: '未推流', active: '推流中', starting: '推流启动中', stopping: '推流停止中', reconnecting: '推流重连中' };
const recordLabels = { off: '未录制', active: '录制中', starting: '录制启动中', stopping: '录制停止中', paused: '录制已暂停' };

export function useObsProgram(obs: ObsControl) {
  const area = ref<HTMLElement>();
  const intersecting = ref(false);
  const foreground = ref(false);
  const connected = computed(() => !obs.unreachable && obs.state?.phase === 'ready');
  const streamLabel = computed(() => obs.state?.stream ? streamLabels[obs.state.stream] : '推流状态未知');
  const recordLabel = computed(() => obs.state?.record ? recordLabels[obs.state.record] : '录制状态未知');
  const frame = shallowRef<Awaited<ReturnType<ObsControl['readProgram']>>>(null);
  const failedRevision = ref<number>();
  const visible = computed(() => connected.value && !!area.value && intersecting.value && foreground.value);
  const image = computed(() => frame.value?.programRevision === obs.state?.programRevision ? frame.value?.image : null);
  const message = computed(() => failedRevision.value === obs.state?.programRevision ? '暂时读不到画面' : '正在读取画面');

  watch(area, (element, _, cleanup) => {
    intersecting.value = false;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { intersecting.value = entry?.isIntersecting ?? false; });
    observer.observe(element);
    cleanup(() => observer.disconnect());
  }, { flush: 'post' });

  const visibility = () => { foreground.value = document.visibilityState === 'visible'; };
  onMounted(() => {
    visibility();
    document.addEventListener('visibilitychange', visibility);
  });
  onUnmounted(() => document.removeEventListener('visibilitychange', visibility));

  watch(visible, (active, _, cleanup) => {
    frame.value = null;
    failedRevision.value = undefined;
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const revision = obs.state?.programRevision;
      try {
        const next = await obs.readProgram(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
        if (controller.signal.aborted) return;
        if (!next) {
          if (revision === obs.state?.programRevision) frame.value = null;
          return;
        }
        frame.value = next;
        failedRevision.value = next.image ? undefined : next.programRevision;
      } catch {
        if (controller.signal.aborted || revision !== obs.state?.programRevision) return;
        frame.value = null;
        failedRevision.value = revision;
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 2000);
      }
    };
    void refresh();
    cleanup(() => { controller.abort(); clearTimeout(timer); });
  });

  return { area, connected, image, message, streamLabel, recordLabel };
}
