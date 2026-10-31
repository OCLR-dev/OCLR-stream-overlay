<script setup lang="ts">
import rulesUrl from '../assets/s11-rules.md?url';
import { useOverlay } from '../useOverlay';
import { regularMods } from '../model';
const banOptions = ['unknown', 'empty', ...regularMods, 'TB'].map(value => ({ value, label: value === 'unknown' ? '未确认' : value === 'empty' ? '空Ban' : value === 'TB' ? 'TB（不可 Ban）' : value }));

const { state, view, feedback, update, select, ban, toggleClean, cycleMap, mapLabels } = useOverlay();
</script>

<template>
  <header class="review-chrome" id="reviewChrome">
    <div class="review-topline">
      <div class="review-brand">
        <span class="review-kicker">OCLR / S11 · NEON BROADCAST</span>
        <span class="review-title">S11 直播 UI <span class="review-version">视觉改版 v2</span></span>
      </div>

      <nav class="scene-tabs" aria-label="核心直播场景">
        <button class="scene-tab" type="button" data-scene-target="waiting" :class="{ 'is-active': state.scene === 'waiting' }" :aria-pressed="state.scene === 'waiting'" @click="update('scene', 'waiting')">
          <span class="scene-tab-no">01</span><span class="scene-tab-label">等待选手</span><span class="scene-tab-now" aria-hidden="true">当前</span>
        </button>
        <button class="scene-tab" type="button" data-scene-target="mappool" :class="{ 'is-active': state.scene === 'mappool' }" :aria-pressed="state.scene === 'mappool'" @click="update('scene', 'mappool')">
          <span class="scene-tab-no">02</span><span class="scene-tab-label">Mappool Ban/Pick</span><span class="scene-tab-now" aria-hidden="true">当前</span>
        </button>
        <button class="scene-tab" type="button" data-scene-target="playing" :class="{ 'is-active': state.scene === 'playing' }" :aria-pressed="state.scene === 'playing'" @click="update('scene', 'playing')">
          <span class="scene-tab-no">03</span><span class="scene-tab-label">Playing</span><span class="scene-tab-now" aria-hidden="true">当前</span>
        </button>
        <button class="scene-tab" type="button" data-scene-target="victory" :class="{ 'is-active': state.scene === 'victory' }" :aria-pressed="state.scene === 'victory'" @click="update('scene', 'victory')">
          <span class="scene-tab-no">04</span><span class="scene-tab-label">全场胜利</span><span class="scene-tab-now" aria-hidden="true">当前</span>
        </button>
        <button class="scene-tab" type="button" data-scene-target="pause" :class="{ 'is-active': state.scene === 'pause' }" :aria-pressed="state.scene === 'pause'" @click="update('scene', 'pause')">
          <span class="scene-tab-no">05</span><span class="scene-tab-label">暂停 / 技术处理</span><span class="scene-tab-now" aria-hidden="true">当前</span>
        </button>
        <button class="scene-tab" type="button" data-scene-target="roll" :class="{ 'is-active': state.scene === 'roll' }" :aria-pressed="state.scene === 'roll'" @click="update('scene', 'roll')">
          <span class="scene-tab-no">06</span><span class="scene-tab-label">Roll / 先手</span><span class="scene-tab-now" aria-hidden="true">当前</span>
        </button>
      </nav>

      <div class="review-actions">
        <button class="clean-button" id="cleanButton" type="button" :aria-pressed="state.clean" @click="toggleClean">{{ state.clean ? '退出干净输出' : '进入干净输出' }}</button>
      </div>
    </div>

    <div class="review-tools review-tools--core">
      <div class="control-group">
        <span class="control-label">常规人数 <em>最终待定</em></span>
        <div class="segmented" role="group" aria-label="常规上场人数">
          <button class="mode-button" type="button" data-mode-target="4v4" :class="{ 'is-active': state.mode === '4v4' }" :aria-pressed="state.mode === '4v4'" @click="update('mode', '4v4')">4v4</button>
          <button class="mode-button" type="button" data-mode-target="3v3" :class="{ 'is-active': state.mode === '3v3' }" :aria-pressed="state.mode === '3v3'" @click="update('mode', '3v3')">3v3</button>
        </div>
      </div>

      <div class="control-group">
        <span class="control-label">阶段 <em>BO11 / BO13</em></span>
        <div class="segmented" role="group" aria-label="S11 阶段">
          <button class="mode-button" type="button" data-stage-target="group" :class="{ 'is-active': state.stage === 'group' }" :aria-pressed="state.stage === 'group'" @click="update('stage', 'group')">小组赛</button>
          <button class="mode-button" type="button" data-stage-target="elimination" :class="{ 'is-active': state.stage === 'elimination' }" :aria-pressed="state.stage === 'elimination'" @click="update('stage', 'elimination')">淘汰赛</button>
          <button class="mode-button" type="button" data-stage-target="final" :class="{ 'is-active': state.stage === 'final' }" :aria-pressed="state.stage === 'final'" @click="update('stage', 'final')">决赛</button>
        </div>
      </div>

      <div class="control-group">
        <span class="control-label">谱面类型 <em>普通 / TB</em></span>
        <div class="segmented" role="group" aria-label="谱面类型">
          <button class="mode-button" type="button" data-maptype-target="normal" :class="{ 'is-active': state.mapType === 'normal' }" :aria-pressed="state.mapType === 'normal'" @click="update('mapType', 'normal')">普通</button>
          <button class="mode-button" type="button" data-maptype-target="tb" :class="{ 'is-active': state.mapType === 'tb' }" :aria-pressed="state.mapType === 'tb'" @click="update('mapType', 'tb')">TB</button>
        </div>
      </div>

      <div class="control-group">
        <span class="control-label">游戏源比例 <em>默认 4:3 · contain</em></span>
        <div class="segmented" role="group" aria-label="游戏源比例">
          <button class="mode-button" type="button" data-source-target="4x3" :class="{ 'is-active': state.source === '4x3' }" :aria-pressed="state.source === '4x3'" @click="update('source', '4x3')">4:3</button>
          <button class="mode-button" type="button" data-source-target="16x9" :class="{ 'is-active': state.source === '16x9' }" :aria-pressed="state.source === '16x9'" @click="update('source', '16x9')">16:9</button>
        </div>
      </div>

      <div class="review-note">
        <span>OCLR S11 · 非正式本地演示 · 不接真实数据</span>
        <span>规则口径见 <a :href="rulesUrl">s11-rules.md</a> · EX 窗口联动 2v2/3v3</span>
        <span>数字键 1–6 切场景 · C 干净输出 · Esc 退出</span>
      </div>
    </div>

    <details class="s11-panel">
      <summary class="s11-summary">
        <span class="s11-summary-main">S11 规则演示</span>
        <span class="s11-summary-sub">系列星位 · Ban / EX · 暂停 · 画面演示</span>
        <span class="s11-summary-note">点击展开设置 · 不自动扣次数或加星</span>
      </summary>

      <div class="s11-panel-body">
        <section class="s11-group">
          <header class="s11-group-head"><h3>系列星位</h3><span>人工演示 · 默认未知</span></header>
          <div class="s11-fields">
            <label class="s11-field">A 队赢图<select class="s11-select" id="seriesASelect" :value="state.seriesA === null ? 'unknown' : String(state.seriesA)" @change="select('seriesA', $event)"><option value="unknown">未知</option><option v-for="n in view.meta.target + 1" :key="n" :value="String(n - 1)">{{ n - 1 }}</option></select></label>
            <label class="s11-field">B 队赢图<select class="s11-select" id="seriesBSelect" :value="state.seriesB === null ? 'unknown' : String(state.seriesB)" @change="select('seriesB', $event)"><option value="unknown">未知</option><option v-for="n in view.meta.target + 1" :key="n" :value="String(n - 1)">{{ n - 1 }}</option></select></label>
          </div>
          <p class="s11-help">星位上限随阶段：小组/淘汰 6，决赛 7。切场景和 EX 标记不会自动加星。</p>
        </section>

        <section class="s11-group s11-group--bp">
          <header class="s11-group-head"><h3>BP / EX</h3><span>本地示意 · 不猜顺序</span></header>
          <div class="s11-fields">
            <label class="s11-field">当前谱面模组
              <select class="s11-select" id="mapModSelect" :value="state.mapMod" @change="select('mapMod', $event)" :disabled="state.mapType === 'tb'">
                <option v-for="mod in regularMods" :key="mod" :value="mod">{{ mod }}</option>
              </select>
            </label>
            <label class="s11-field">EX 开启方
              <select class="s11-select" id="exTeamSelect" :value="state.exTeam" @change="select('exTeam', $event)" :disabled="state.mapType === 'tb'">
                <option value="none">未开启</option><option value="a">示例A队</option><option value="b">示例B队</option>
              </select>
            </label>
            <label class="s11-field">先 Pick
              <select class="s11-select" id="pickFirstSelect" :value="state.pickFirst" @change="select('pickFirst', $event)">
                <option value="unknown">未确认</option><option value="a">示例A队</option><option value="b">示例B队</option>
              </select>
            </label>
            <label class="s11-field">先 Ban
              <select class="s11-select" id="banFirstSelect" :value="state.banFirst" @change="select('banFirst', $event)">
                <option value="unknown">未确认</option><option value="a">示例A队</option><option value="b">示例B队</option>
              </select>
            </label>
            <label class="s11-field">A 队 EX 剩余
              <select class="s11-select" id="exRemainingA" :value="state.exA" @change="select('exA', $event)"><option value="2">2</option><option value="1">1</option><option value="0">0</option></select>
            </label>
            <label class="s11-field">B 队 EX 剩余
              <select class="s11-select" id="exRemainingB" :value="state.exB" @change="select('exB', $event)"><option value="2">2</option><option value="1">1</option><option value="0">0</option></select>
            </label>
          </div>

          <div class="s11-ban-grid">
            <span class="s11-ban-label">A Ban</span>
            <select class="s11-select s11-ban-select" data-ban-slot="a0" aria-label="示例A队 Ban 1" :value="state.banSlots.a[0]" @change="ban('a', 0, $event)"><option v-for="option in banOptions" :key="option.value" :value="option.value" :disabled="option.value === 'TB'">{{ option.label }}</option></select>
            <select class="s11-select s11-ban-select" data-ban-slot="a1" aria-label="示例A队 Ban 2" :value="state.banSlots.a[1]" @change="ban('a', 1, $event)"><option v-for="option in banOptions" :key="option.value" :value="option.value" :disabled="option.value === 'TB'">{{ option.label }}</option></select>
            <span class="s11-ban-label">B Ban</span>
            <select class="s11-select s11-ban-select" data-ban-slot="b0" aria-label="示例B队 Ban 1" :value="state.banSlots.b[0]" @change="ban('b', 0, $event)"><option v-for="option in banOptions" :key="option.value" :value="option.value" :disabled="option.value === 'TB'">{{ option.label }}</option></select>
            <select class="s11-select s11-ban-select" data-ban-slot="b1" aria-label="示例B队 Ban 2" :value="state.banSlots.b[1]" @change="ban('b', 1, $event)"><option v-for="option in banOptions" :key="option.value" :value="option.value" :disabled="option.value === 'TB'">{{ option.label }}</option></select>
          </div>

          <p class="s11-feedback" id="bpFeedback" role="status" aria-live="polite">{{ feedback }}</p>
          <p class="s11-help">同队两次 Ban 不得同 mod（NM/FM 例外）；TB 不可 Ban、禁 EX。EX 按双方常规人数各减 1 路（常规3v3→EX2v2，常规4v4→EX3v3），不改 EX 剩余次数/星位；后排标签为合成示例，不接真实阵容；不做首 Pick/对方 Pick 规则引擎。</p>
        </section>

        <section class="s11-group">
          <header class="s11-group-head"><h3>暂停演示</h3><span>人工状态</span></header>
          <div class="segmented" role="group" aria-label="暂停类型">
            <button class="mode-button" type="button" data-pause-type-target="tactical" :class="{ 'is-active': state.pauseType === 'tactical' }" :aria-pressed="state.pauseType === 'tactical'" @click="update('pauseType', 'tactical')">战术暂停</button>
            <button class="mode-button" type="button" data-pause-type-target="technical" :class="{ 'is-active': state.pauseType === 'technical' }" :aria-pressed="state.pauseType === 'technical'" @click="update('pauseType', 'technical')">技术处理</button>
          </div>
          <div class="s11-fields">
            <label class="s11-field">A 队战术暂停
              <select class="s11-select" id="tacticalASelect" :value="state.tacticalA" @change="select('tacticalA', $event)"><option value="available">可用</option><option value="used">已用</option></select>
            </label>
            <label class="s11-field">B 队战术暂停
              <select class="s11-select" id="tacticalBSelect" :value="state.tacticalB" @change="select('tacticalB', $event)"><option value="available">可用</option><option value="used">已用</option></select>
            </label>
            <label class="s11-field">A 队重赛机会
              <select class="s11-select" id="rematchASelect" :value="state.rematchA" @change="select('rematchA', $event)"><option value="unknown">未确认</option><option value="available">可用（人工确认）</option><option value="used">已用</option></select>
            </label>
            <label class="s11-field">B 队重赛机会
              <select class="s11-select" id="rematchBSelect" :value="state.rematchB" @change="select('rematchB', $event)"><option value="unknown">未确认</option><option value="available">可用（人工确认）</option><option value="used">已用</option></select>
            </label>
          </div>
          <p class="s11-help">战术暂停暂定 3:00；恢复时间未确认，不做倒计时。技术处理不自动消耗战术暂停；30 秒后重赛机会须人工确认，不自动判罚。</p>
        </section>

        <section class="s11-group s11-group--demos">
          <header class="s11-group-head"><h3>画面演示</h3><span>既有控件</span></header>
          <div class="s11-demo-stack">
            <div class="control-group control-group--wide">
              <span class="control-label">等待演示 <em>仅等待场景</em></span>
              <div class="demo-buttons" role="group" aria-label="选手到场演示">
                <button class="demo-button" type="button" data-arrival="none" :class="{ 'is-active': state.arrival === 'none' }" :aria-pressed="state.arrival === 'none'" @click="update('arrival', 'none')">全部等待</button>
                <button class="demo-button" type="button" data-arrival="a" :class="{ 'is-active': state.arrival === 'a' }" :aria-pressed="state.arrival === 'a'" @click="update('arrival', 'a')">示例A队到场</button>
                <button class="demo-button" type="button" data-arrival="both" :class="{ 'is-active': state.arrival === 'both' }" :aria-pressed="state.arrival === 'both'" @click="update('arrival', 'both')">双方到场</button>
              </div>
            </div>

            <div class="control-group">
              <span class="control-label">比分演示 <em>仅 Playing</em></span>
              <div class="segmented segmented--lead" role="group" aria-label="比分演示状态">
                <button class="mode-button" type="button" data-lead-target="left-small" :class="{ 'is-active': state.lead === 'left-small' }" :aria-pressed="state.lead === 'left-small'" @click="update('lead', 'left-small')">左小领先</button>
                <button class="mode-button" type="button" data-lead-target="left-large" :class="{ 'is-active': state.lead === 'left-large' }" :aria-pressed="state.lead === 'left-large'" @click="update('lead', 'left-large')">左大领先</button>
                <button class="mode-button" type="button" data-lead-target="equal" :class="{ 'is-active': state.lead === 'equal' }" :aria-pressed="state.lead === 'equal'" @click="update('lead', 'equal')">平分</button>
                <button class="mode-button" type="button" data-lead-target="right-small" :class="{ 'is-active': state.lead === 'right-small' }" :aria-pressed="state.lead === 'right-small'" @click="update('lead', 'right-small')">右小领先</button>
                <button class="mode-button" type="button" data-lead-target="right-large" :class="{ 'is-active': state.lead === 'right-large' }" :aria-pressed="state.lead === 'right-large'" @click="update('lead', 'right-large')">右大领先</button>
              </div>
            </div>

            <div class="control-group">
              <span class="control-label">图池焦点 <em>仅 Mappool</em></span>
              <div class="demo-map-row">
                <button class="demo-button" id="mapCycleButton" type="button" @click="cycleMap">切换焦点谱面状态</button>
                <span class="control-readout" id="mapReadout" aria-live="polite">{{ mapLabels[state.map] }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </details>
  </header>
</template>
