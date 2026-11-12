<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ObsControl } from '../obsControl';
import ControlSelect from './ControlSelect.vue';

const props = defineProps<{ obs: ObsControl }>();
const port = ref(4455);
const password = ref<HTMLInputElement>();
const layouts = [{ key: 'regular', label: '常规 4v4' }, { key: 'ex', label: 'EX 3v3' }] as const;
const positions = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'];
watch(() => props.obs.state?.port, value => { if (value) port.value = value; }, { immediate: true });
function connect() {
  const value = password.value?.value || '';
  if (password.value) password.value.value = '';
  void props.obs.act('connect', { port: port.value, password: value });
}
</script>

<template>
  <details class="operator-import obs-settings">
    <summary>OBS 场景联动</summary>
    <p role="status">{{ obs.status }}<template v-if="obs.state?.collection"> · 场景集合「{{ obs.state.collection }}」</template></p>
    <p v-if="obs.error || obs.state?.error" class="operator-error" role="alert">{{ obs.error || obs.state?.error }}</p>
    <form v-if="obs.state?.phase !== 'ready'" @submit.prevent="connect">
      <p>在 OBS 的「工具 → WebSocket 服务器设置」中启用服务和密码认证，输入这台电脑的端口与密码。</p>
      <div class="setup-meta">
        <label>OBS 端口<input v-model.number="port" type="number" min="1" max="65535" required></label>
        <label>OBS 密码<input ref="password" type="password" autocomplete="off" maxlength="1024" :placeholder="obs.state?.hasPassword ? '已保存，留空可复用' : ''"></label>
        <button type="submit" :disabled="!!obs.pending || obs.state?.phase === 'connecting'">连接本机 OBS</button>
        <button v-if="obs.state?.enabled" type="button" :disabled="!!obs.pending" @click="obs.act('disconnect')">断开连接</button>
      </div>
    </form>
    <template v-else>
      <div class="operator-inline">
        <button class="operator-primary" :disabled="!!obs.pending" @click="obs.act('create')">{{ obs.pending === 'create' ? '正在创建比赛场景…' : '创建比赛场景' }}</button>
        <button :disabled="!!obs.pending" @click="obs.act('disconnect')">断开连接</button>
      </div>
      <p>常规八路和 EX 六路共用观众画面和桌面音频。旧预设可再点一次「创建比赛场景」补上声音。自建场景可直接在下方选择。</p>
      <div class="setup-meta">
        <label v-for="layout in layouts" :key="layout.key">{{ layout.label }} 场景
          <ControlSelect :value="obs.state[layout.key]" :disabled="!!obs.pending" :aria-label="layout.label + ' 场景'" @change="obs.act('bind', { layout: layout.key, name: $event })">
            <option value="" disabled>选择场景</option>
            <option v-if="obs.state[layout.key] && !obs.state.scenes.includes(obs.state[layout.key])" :value="obs.state[layout.key]" disabled>{{ obs.state[layout.key] }}（未找到）</option>
            <option v-for="name in obs.state.scenes" :key="name" :value="name" :disabled="name === obs.state[layout.key === 'ex' ? 'regular' : 'ex']">{{ name }}</option>
          </ControlSelect>
        </label>
      </div>
      <div class="operator-inline">
        <label class="operator-check"><input type="checkbox" :checked="obs.state.follow" :disabled="!!obs.pending || (!obs.state.follow && (!obs.state.regular || !obs.state.ex))" @change="obs.act('follow', { enabled: ($event.target as HTMLInputElement).checked })">OBS 跟随 EX</label>
        <button v-if="obs.canReturn" :disabled="!!obs.pending" @click="obs.act('return')">切回当前比赛布局</button>
      </div>
      <p v-if="!obs.state.target">这套预设用于正赛 4v4。请核对本场人数和阶段。</p>
      <template v-if="obs.state.managed">
        <h3>核对捕获窗口</h3>
        <p>启动 osu!tourney，核对 A 为左侧红队、B 为右侧蓝队。窗口缺失或重名时，在对应槽位补选。</p>
        <button :disabled="!!obs.pending" @click="obs.act('scan')">{{ obs.pending === 'scan' ? '正在识别…' : '重新识别窗口' }}</button>
        <div class="obs-slots">
          <label v-for="row in obs.state.rows" :key="row.slot">{{ row.slot }} · {{ row.status }}
            <ControlSelect :value="row.value" :disabled="!!obs.pending" :aria-label="row.slot + ' 捕获窗口'" @change="obs.act('window', { slot: row.slot, value: $event })">
              <option value="">留空</option>
              <option v-if="row.value && !obs.state.windows.some(w => w.value === row.value)" :value="row.value" disabled>原窗口未识别</option>
              <option v-for="w in obs.state.windows" :key="w.value" :value="w.value" :disabled="obs.state.rows.some(r => r.slot !== row.slot && r.value === w.value)">{{ w.label }}</option>
            </ControlSelect>
          </label>
        </div>
        <h3>EX 实际上场的六路</h3>
        <p>按本图上场阵容选择捕获源。选到同队已上场的捕获源时，两个位置互换。</p>
        <div class="obs-slots">
          <label v-for="(position, index) in positions" :key="position">EX {{ position }}
            <ControlSelect :value="obs.state.lineup[index]" :disabled="!!obs.pending" :aria-label="'EX ' + position + ' 捕获源'" @change="obs.act('lineup', { position, slot: $event })">
              <option v-for="n in 4" :key="n" :value="position[0] + String(n)">常规 {{ position[0] }}{{ n }}</option>
            </ControlSelect>
          </label>
        </div>
      </template>
      <details v-if="obs.state.regular && obs.state.ex">
        <summary>核对 OBS 原始尺寸与位置</summary>
        <p>两套场景有捕获画面时读取一次。可复制结果，逐路核对来源、可见性、锚点、位置、缩放与裁切。</p>
        <button :disabled="!!obs.pending" @click="obs.act('measure')">{{ obs.pending === 'measure' ? '正在读取…' : '读取两套场景' }}</button>
        <label v-if="obs.measurement">本次 OBS 读数<textarea :value="obs.measurement" readonly rows="6" spellcheck="false"></textarea></label>
      </details>
    </template>
  </details>
</template>

<style scoped>
.obs-settings > * + *, .obs-settings form > * + * { margin-top: 10px; }
.obs-slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 8px 16px; }
.obs-slots label { min-width: 0; }
</style>
