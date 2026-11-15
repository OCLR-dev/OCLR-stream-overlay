<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ObsControl } from '../obsControl';
import { MessagesSquare, Check, MonitorCheck, Unplug, TriangleAlert, Eye, EyeOff, RefreshCw } from '@lucide/vue';

const props = defineProps<{ obs: ObsControl; showcaseOnly?: boolean }>();
const code = ref('');
const hint = ref('');
const failed = ref(false);
const editing = ref(false);
const visible = ref(false);
const connected = computed(() => !props.obs.unreachable && props.obs.state?.phase === 'ready');
const hasScenes = computed(() => {
  const state = props.obs.state;
  return !!state && (props.showcaseOnly ? state.showcase :
    !!state.regular && !!state.ex && state.scenes.includes(state.regular) && state.scenes.includes(state.ex));
});
const configured = computed(() => props.obs.state?.streamChat === 'configured' && hasScenes.value);
const busy = computed(() => props.obs.pending === 'stream-chat');
const status = computed(() => !connected.value ? '等待 OBS' : busy.value ? '配置中' : failed.value ? '配置失败' :
  configured.value ? '已配置' : props.obs.state?.streamChat !== 'off' ? '待配置' : '未设置');
const showInput = computed(() => editing.value || props.obs.state?.streamChat === 'off' || !!code.value);
const message = computed(() => {
  if (!connected.value) return '连接本机 OBS 后即可粘贴身份码。';
  if (busy.value) return '正在配置弹幕源…';
  if (failed.value) return '未能配置弹幕源，请核对 OBS 连接后重试。';
  if (configured.value) return props.showcaseOnly ? 'Showcase 弹幕源已配置。' : '常规与 EX 场景已共用弹幕源。';
  if (props.obs.state?.streamChat !== 'off') return hasScenes.value ? '身份码已保存，弹幕源待配置。' :
    props.showcaseOnly ? '身份码已保存，创建 Showcase 场景后会自动加入弹幕。' : '身份码已保存，创建或绑定常规与 EX 场景后会自动加入弹幕。';
  return '粘贴后自动配置；手动输入可按回车或离开输入框。';
});
let generation = 0;
watch(() => props.obs.state?.collection, () => {
  generation++;
  code.value = ''; hint.value = ''; failed.value = false; editing.value = false; visible.value = false;
});
watch(configured, value => { if (value) failed.value = false; });
async function apply(retry = false) {
  if (props.obs.pending || !connected.value) return;
  const value = code.value.trim();
  if (!value && !retry) return;
  if (value && !/^[0-9A-Z]{12,14}$/.test(value)) {
    hint.value = '身份码由 12 至 14 位大写字母或数字组成，请核对后重新粘贴。';
    return;
  }
  hint.value = ''; failed.value = false;
  const revision = generation;
  const success = await props.obs.act('stream-chat', value ? { code: value } : {});
  if (revision !== generation) return;
  failed.value = !success;
  if (success) { code.value = ''; editing.value = false; visible.value = false; }
}
function edit(event: Event) {
  code.value = (event.target as HTMLInputElement).value;
  hint.value = '';
  if ((event as InputEvent).inputType === 'insertFromPaste') void apply();
}
</script>

<template>
  <section class="obs-stream-chat" aria-labelledby="obs-stream-chat-heading">
    <div class="operator-section-head"><h3 id="obs-stream-chat-heading"><MessagesSquare :size="20" aria-hidden="true" />B 站直播间弹幕</h3><span class="setup-badge">{{ status }}</span></div>
    <p v-if="!connected" class="setup-callout"><Unplug :size="18" aria-hidden="true" />先在上方连接本机 OBS，再设置直播间弹幕。</p>
    <template v-else>
      <div v-if="showInput" class="obs-chat-entry">
        <div><h4>获取直播身份码</h4><p>用主播账号登录 <a href="https://play-live.bilibili.com/" target="_blank" rel="noopener noreferrer">B 站互动玩法 ↗</a>，复制「身份码」。<a href="https://blive.chat/help" target="_blank" rel="noopener noreferrer">查看图文教程 ↗</a></p></div>
        <label>直播身份码
          <div class="obs-chat-code"><input :value="code" :type="visible ? 'text' : 'password'" autocomplete="off" spellcheck="false" maxlength="100"
            placeholder="粘贴身份码后自动配置" aria-label="直播身份码" :aria-describedby="hint ? 'obs-chat-status obs-chat-hint' : 'obs-chat-status'" :aria-invalid="!!hint" :disabled="!!obs.pending"
            @input="edit" @blur="apply()" @keydown.enter.prevent="!$event.isComposing && apply()">
            <button type="button" :aria-pressed="visible" @click="visible = !visible"><EyeOff v-if="visible" :size="16" aria-hidden="true" /><Eye v-else :size="16" aria-hidden="true" />{{ visible ? '隐藏' : '显示' }}</button>
          </div>
        </label>
        <p v-if="hint" id="obs-chat-hint" class="operator-error" role="alert">{{ hint }}</p>
      </div>
      <div class="obs-chat-result">
      <p id="obs-chat-status" role="status" :class="{ 'operator-error': failed, 'status-good': configured && !failed }"><TriangleAlert v-if="failed" :size="18" aria-hidden="true" /><Check v-else-if="configured" :size="18" aria-hidden="true" />{{ message }}</p>
      <div class="operator-inline">
        <button v-if="failed || (obs.state?.streamChat === 'pending' && hasScenes)" :disabled="!!obs.pending" @click="apply(true)"><RefreshCw :size="16" aria-hidden="true" />重试配置弹幕源</button>
        <button v-if="!showInput && !busy" @click="editing = true">更换身份码</button>
      </div>
      </div>
      <p v-if="configured" class="obs-chat-check"><MonitorCheck :size="17" aria-hidden="true" />在 OBS 的 STREAM CHAT 核对实际观众消息。</p>
    </template>
  </section>
</template>

<style scoped>
.obs-stream-chat { display: grid; gap: 14px; margin-top: 24px; padding-top: 22px; border-top: 1px solid var(--op-line); }
.obs-stream-chat .operator-section-head { margin-bottom: 0; }
.obs-stream-chat h4 { margin: 0; font-size: 14px; }
.obs-chat-dependency { font-size: 13px; }
.obs-chat-entry { display: grid; gap: 18px; }
.obs-chat-code { display: flex; gap: 8px; }
.obs-chat-code input { min-width: 0; flex: 1; }
.obs-chat-code button { flex-shrink: 0; }
.obs-stream-chat .operator-inline:empty { display: none; }
.obs-chat-result { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.obs-chat-result p, .obs-chat-check, .obs-stream-chat button { display: flex; align-items: center; gap: 8px; }
.obs-stream-chat svg { flex-shrink: 0; }
.obs-stream-chat .obs-chat-check { font-size: 12px; }
</style>
