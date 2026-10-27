(() => {
  'use strict';

  const CANVAS_WIDTH = 1920;
  const CANVAS_HEIGHT = 1080;

  const SCENES = ['waiting', 'mappool', 'playing', 'map-result', 'victory', 'pause'];
  const SCENE_LABELS = {
    waiting: '等待选手',
    mappool: 'Mappool Ban/Pick',
    playing: 'Playing',
    'map-result': '单图结算',
    victory: '全场胜利',
    pause: '暂停 / 技术处理'
  };
  const TEAM_COUNTS = { '4v4': 4, '3v3': 3 };
  const STAGE_META = {
    group: { label: '小组赛', format: 'BO11', target: 6 },
    elimination: { label: '淘汰赛', format: 'BO11', target: 6 },
    final: { label: '决赛', format: 'BO13', target: 7 }
  };
  const STAGES = Object.keys(STAGE_META);
  const MAP_TYPES = ['normal', 'tb'];
  const FORMAT_LABELS = { normal: '普通', ex: 'EX', tb: 'TB' };
  const MAP_MODS = ['NM', 'HD', 'HR', 'FM'];
  const EX_TEAMS = ['none', 'a', 'b'];
  const ORDER_STATES = ['unknown', 'a', 'b'];
  const BAN_STATES = ['unknown', 'empty', 'NM', 'HD', 'HR', 'FM'];
  const PAUSE_TYPES = ['tactical', 'technical'];
  const PAUSE_AVAILABILITY = ['available', 'used'];
  const REMATCH_STATES = ['unknown', 'available', 'used'];
  const PLAYER_ROLES = ['Captain', 'T1', 'T2', 'T3'];
  const MAP_ROW_MODS = [
    'NM', 'HD', 'HR', 'FM', 'NM', 'HD',
    'HR', 'FM', 'NM', 'HD', 'HR', 'FM',
    'NM', 'HD', 'HR', 'FM', 'NM', 'TB'
  ];
  const SOURCE_RATIOS = { '4x3': '4:3', '16x9': '16:9' };
  const LEAD_STATES = ['left-small', 'left-large', 'equal', 'right-small', 'right-large'];
  const LEGACY_LEAD_STATES = { left: 'left-small', right: 'right-small' };
  const LEAD_DEMOS = {
    'left-small': { a: '1,050,000', b: '1,000,000' },
    'left-large': { a: '1,400,000', b: '1,000,000' },
    equal: { a: '1,000,000', b: '1,000,000' },
    'right-small': { a: '1,000,000', b: '1,050,000' },
    'right-large': { a: '1,000,000', b: '1,400,000' }
  };
  const TEAM_NAMES = { a: '示例A队', b: '示例B队' };
  const RESULT_PLAYER_SCORES = {
    a: [350000, 320000, 300000, 280000],
    b: [330000, 310000, 290000, 260000]
  };
  const ARRIVAL_STATES = ['none', 'a', 'both'];
  const MAP_STATES = ['open', 'banned', 'picked'];
  const MAP_ORDER = ['banned', 'picked', 'open'];
  const MAP_LABELS = {
    open: '未选',
    banned: '禁用 · 示例A队',
    picked: '选用 · 示例B队'
  };
  const MAP_ICONS = { open: '○', banned: '×', picked: '✓' };

  const MAP_GROUPS = [
    { code: 'A', label: '分组占位 A' },
    { code: 'B', label: '分组占位 B' },
    { code: 'C', label: '分组占位 C' }
  ];

  const state = {
    scene: 'waiting',
    mode: '4v4',
    source: '4x3',
    lead: 'equal',
    clean: false,
    arrival: 'none',
    map: 'banned',
    stage: 'group',
    mapType: 'normal',
    mapMod: 'NM',
    exTeam: 'none',
    exA: 2,
    exB: 2,
    seriesA: null,
    seriesB: null,
    pickFirst: 'unknown',
    banFirst: 'unknown',
    banSlots: { a: ['unknown', 'unknown'], b: ['unknown', 'unknown'] },
    pauseType: 'tactical',
    tacticalA: 'available',
    tacticalB: 'available',
    rematchA: 'unknown',
    rematchB: 'unknown'
  };

  const elements = {
    canvas: document.getElementById('broadcastCanvas'),
    canvasStage: document.getElementById('canvasStage'),
    canvasSizer: document.getElementById('canvasSizer'),
    chrome: document.getElementById('reviewChrome'),
    cleanButton: document.getElementById('cleanButton'),
    mapCycleButton: document.getElementById('mapCycleButton'),
    mapReadout: document.getElementById('mapReadout'),
    stageButtons: Array.from(document.querySelectorAll('[data-stage-target]')),
    mapTypeButtons: Array.from(document.querySelectorAll('[data-maptype-target]')),
    pauseTypeButtons: Array.from(document.querySelectorAll('[data-pause-type-target]')),
    seriesASelect: document.getElementById('seriesASelect'),
    seriesBSelect: document.getElementById('seriesBSelect'),
    mapModSelect: document.getElementById('mapModSelect'),
    exTeamSelect: document.getElementById('exTeamSelect'),
    pickFirstSelect: document.getElementById('pickFirstSelect'),
    banFirstSelect: document.getElementById('banFirstSelect'),
    exRemainingA: document.getElementById('exRemainingA'),
    exRemainingB: document.getElementById('exRemainingB'),
    bpFeedback: document.getElementById('bpFeedback'),
    tacticalASelect: document.getElementById('tacticalASelect'),
    tacticalBSelect: document.getElementById('tacticalBSelect'),
    rematchASelect: document.getElementById('rematchASelect'),
    rematchBSelect: document.getElementById('rematchBSelect'),
    banSlotSelects: Array.from(document.querySelectorAll('[data-ban-slot]')),
    stageLabelEls: Array.from(document.querySelectorAll('[data-stage-label]')),
    seriesTargetEls: Array.from(document.querySelectorAll('[data-series-target]')),
    formatLabelEls: Array.from(document.querySelectorAll('[data-format-label]')),
    modeLabelEls: Array.from(document.querySelectorAll('[data-mode-label]')),
    modeShortEls: Array.from(document.querySelectorAll('[data-mode-short]')),
    seriesStarA: document.querySelector('[data-series-stars="a"]'),
    seriesStarB: document.querySelector('[data-series-stars="b"]'),
    mapInfoFormats: Array.from(document.querySelectorAll('[data-map-format]')),
    mapInfoMods: Array.from(document.querySelectorAll('[data-map-mod]')),
    mapInfoEx: Array.from(document.querySelectorAll('[data-map-ex]')),
    mapInfoRules: Array.from(document.querySelectorAll('[data-map-rule]')),
    banSlotViews: Array.from(document.querySelectorAll('[data-ban-slot-view]')),
    exRemainingViews: Array.from(document.querySelectorAll('[data-ex-remaining]')),
    pickFirstViews: Array.from(document.querySelectorAll('[data-pick-first]')),
    banFirstViews: Array.from(document.querySelectorAll('[data-ban-first]')),
    mappoolFormatViews: Array.from(document.querySelectorAll('[data-mappool-format]')),
    mappoolModViews: Array.from(document.querySelectorAll('[data-mappool-mod]')),
    mappoolExViews: Array.from(document.querySelectorAll('[data-mappool-ex]')),
    pauseTitleEls: Array.from(document.querySelectorAll('[data-pause-title]')),
    pauseHeadlineEls: Array.from(document.querySelectorAll('[data-pause-headline]')),
    pauseTypeLabelEls: Array.from(document.querySelectorAll('[data-pause-type-label]')),
    pauseFooterTypeEls: Array.from(document.querySelectorAll('[data-pause-footer-type]')),
    pauseDurationEls: Array.from(document.querySelectorAll('[data-pause-duration]')),
    pauseAStatusEls: Array.from(document.querySelectorAll('[data-pause-a-status]')),
    pauseBStatusEls: Array.from(document.querySelectorAll('[data-pause-b-status]')),
    rematchStatusEls: Array.from(document.querySelectorAll('[data-rematch-status]')),
    victoryStageEls: Array.from(document.querySelectorAll('[data-victory-stage]')),
    victoryTargetEls: Array.from(document.querySelectorAll('[data-victory-target]')),
    scoreStage: document.getElementById('scoreStage'),
    scoreValueA: document.getElementById('scoreValueA'),
    scoreValueB: document.getElementById('scoreValueB'),
    resultPlayfield: document.querySelector('[data-result-playfield]'),
    resultScoreStage: document.getElementById('resultScoreStage'),
    resultTotalA: document.getElementById('resultTotalA'),
    resultTotalB: document.getElementById('resultTotalB'),
    readinessHeadline: document.getElementById('readinessHeadline'),
    readinessCount: document.getElementById('readinessCount'),
    readinessCopy: document.getElementById('readinessCopy'),
    waitingCommentary: document.querySelector('[data-waiting-commentary]'),
    playfield: document.querySelector('[data-playfield]'),
    mappoolColumns: document.querySelector('[data-mappool-columns]')
  };

  const sceneButtons = Array.from(document.querySelectorAll('[data-scene-target]'));
  const modeButtons = Array.from(document.querySelectorAll('[data-mode-target]'));
  const sourceButtons = Array.from(document.querySelectorAll('[data-source-target]'));
  const leadButtons = Array.from(document.querySelectorAll('[data-lead-target]'));
  const arrivalButtons = Array.from(document.querySelectorAll('[data-arrival]'));
  const scenePanels = Array.from(document.querySelectorAll('[data-scene-panel]'));

  let fitFrame = 0;
  let locationListenerActive = true;

  function parseBoolean(value) {
    return value === '1' || value === 'true';
  }

  function firstKnown(value, known, fallback) {
    return known.includes(value) ? value : fallback;
  }

  function parseAllowedInteger(value, allowed, fallback) {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }
    const number = Number(value);
    return allowed.includes(number) ? number : fallback;
  }

  function parseSeriesValue(value, target) {
    if (value === null || value === undefined || value === '' || value === 'unknown') {
      return null;
    }
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= target ? number : null;
  }

  function sanitizeBanPair(values) {
    const pair = values.map(value => BAN_STATES.includes(value) ? value : 'unknown');
    if (pair[0] === pair[1] && !['unknown', 'empty', 'NM', 'FM'].includes(pair[0])) {
      pair[1] = 'unknown';
    }
    return pair;
  }

  function readLocationState() {
    const query = new URLSearchParams(window.location.search);
    const rawHash = window.location.hash.replace(/^#/, '');
    const hash = new URLSearchParams(rawHash);

    function getValue(key) {
      return hash.has(key) ? hash.get(key) : query.get(key);
    }

    let scene = hash.get('scene');
    if (!scene && SCENES.includes(rawHash)) {
      scene = rawHash;
    }
    if (!scene) {
      scene = query.get('scene');
    }

    let clean = false;
    if (hash.has('clean')) {
      clean = parseBoolean(hash.get('clean'));
    } else if (query.has('clean')) {
      clean = parseBoolean(query.get('clean'));
    }

    const stage = firstKnown(getValue('stage'), STAGES, 'group');
    const stageMeta = STAGE_META[stage];
    const mapType = firstKnown(getValue('maptype'), MAP_TYPES, 'normal');
    let exTeam = firstKnown(getValue('exTeam'), EX_TEAMS, 'none');
    if (mapType === 'tb') {
      exTeam = 'none';
    }

    const banSlots = {
      a: sanitizeBanPair([getValue('banA1') || 'unknown', getValue('banA2') || 'unknown']),
      b: sanitizeBanPair([getValue('banB1') || 'unknown', getValue('banB2') || 'unknown'])
    };

    return {
      scene: firstKnown(scene, SCENES, 'waiting'),
      mode: firstKnown(getValue('mode'), Object.keys(TEAM_COUNTS), '4v4'),
      source: firstKnown(getValue('source'), Object.keys(SOURCE_RATIOS), '4x3'),
      lead: normalizeLeadState(getValue('lead')),
      clean,
      arrival: firstKnown(getValue('arrival'), ARRIVAL_STATES, 'none'),
      map: firstKnown(getValue('map'), MAP_STATES, 'banned'),
      stage,
      mapType,
      mapMod: firstKnown(getValue('mod'), MAP_MODS, 'NM'),
      exTeam,
      exA: parseAllowedInteger(getValue('exA'), [0, 1, 2], 2),
      exB: parseAllowedInteger(getValue('exB'), [0, 1, 2], 2),
      seriesA: parseSeriesValue(getValue('starA'), stageMeta.target),
      seriesB: parseSeriesValue(getValue('starB'), stageMeta.target),
      pickFirst: firstKnown(getValue('pickFirst'), ORDER_STATES, 'unknown'),
      banFirst: firstKnown(getValue('banFirst'), ORDER_STATES, 'unknown'),
      banSlots,
      pauseType: firstKnown(getValue('pauseType'), PAUSE_TYPES, 'tactical'),
      tacticalA: firstKnown(getValue('tacticalA'), PAUSE_AVAILABILITY, 'available'),
      tacticalB: firstKnown(getValue('tacticalB'), PAUSE_AVAILABILITY, 'available'),
      rematchA: firstKnown(getValue('rematchA'), REMATCH_STATES, 'unknown'),
      rematchB: firstKnown(getValue('rematchB'), REMATCH_STATES, 'unknown')
    };
  }

  function statesMatch(a, b) {
    return a.scene === b.scene &&
      a.mode === b.mode &&
      a.source === b.source &&
      a.lead === b.lead &&
      a.clean === b.clean &&
      a.arrival === b.arrival &&
      a.map === b.map &&
      a.stage === b.stage &&
      a.mapType === b.mapType &&
      a.mapMod === b.mapMod &&
      a.exTeam === b.exTeam &&
      a.exA === b.exA &&
      a.exB === b.exB &&
      a.seriesA === b.seriesA &&
      a.seriesB === b.seriesB &&
      a.pickFirst === b.pickFirst &&
      a.banFirst === b.banFirst &&
      a.banSlots.a[0] === b.banSlots.a[0] &&
      a.banSlots.a[1] === b.banSlots.a[1] &&
      a.banSlots.b[0] === b.banSlots.b[0] &&
      a.banSlots.b[1] === b.banSlots.b[1] &&
      a.pauseType === b.pauseType &&
      a.tacticalA === b.tacticalA &&
      a.tacticalB === b.tacticalB &&
      a.rematchA === b.rematchA &&
      a.rematchB === b.rematchB;
  }

  function writeLocationState() {
    const hash = new URLSearchParams({
      scene: state.scene,
      mode: state.mode,
      source: state.source,
      lead: state.lead,
      clean: state.clean ? '1' : '0',
      arrival: state.arrival,
      map: state.map,
      stage: state.stage,
      maptype: state.mapType,
      mod: state.mapMod,
      exTeam: state.exTeam,
      exA: String(state.exA),
      exB: String(state.exB),
      starA: state.seriesA === null ? 'unknown' : String(state.seriesA),
      starB: state.seriesB === null ? 'unknown' : String(state.seriesB),
      pickFirst: state.pickFirst,
      banFirst: state.banFirst,
      banA1: state.banSlots.a[0],
      banA2: state.banSlots.a[1],
      banB1: state.banSlots.b[0],
      banB2: state.banSlots.b[1],
      pauseType: state.pauseType,
      tacticalA: state.tacticalA,
      tacticalB: state.tacticalB,
      rematchA: state.rematchA,
      rematchB: state.rematchB
    });

    const nextUrl = new URL(window.location.href);
    [
      'scene', 'mode', 'source', 'lead', 'clean', 'arrival', 'map',
      'stage', 'maptype', 'mod', 'exTeam', 'exA', 'exB', 'starA', 'starB',
      'pickFirst', 'banFirst', 'banA1', 'banA2', 'banB1', 'banB2',
      'pauseType', 'tacticalA', 'tacticalB', 'rematchA', 'rematchB'
    ].forEach(key => {
      nextUrl.searchParams.delete(key);
    });
    nextUrl.hash = hash.toString();

    locationListenerActive = false;
    try {
      window.history.replaceState(null, '', nextUrl.href);
    } catch (error) {
      try {
        window.location.hash = hash.toString();
      } catch (hashError) {
        // The page still works without URL persistence in restricted contexts.
      }
    }
    locationListenerActive = true;
  }

  function normalizeLeadState(value) {
    if (LEAD_STATES.includes(value)) {
      return value;
    }
    return LEGACY_LEAD_STATES[value] || 'equal';
  }

  function basePlayerCount() {
    return TEAM_COUNTS[state.mode] || 4;
  }

  function isExActive() {
    return currentFormat() === 'ex';
  }

  function activePlayerCount() {
    const base = basePlayerCount();
    return isExActive() ? Math.max(2, base - 1) : base;
  }

  function activeModeLabel() {
    const count = activePlayerCount();
    return isExActive() ? `EX ${count}v${count}` : `${count}v${count}`;
  }

  function rosterForTeam(team) {
    const base = basePlayerCount();
    if (isExActive()) {
      const count = activePlayerCount();
      return Array.from({ length: count }, (_, index) => ({
        id: `${team.toUpperCase()}${index + 3}`,
        role: `T${index + 2}`,
        slot: index + 1,
        syntheticEx: true
      }));
    }
    return Array.from({ length: base }, (_, index) => ({
      id: `${team.toUpperCase()}${index + 1}`,
      role: PLAYER_ROLES[index] || `T${index}`,
      slot: index + 1,
      syntheticEx: false
    }));
  }

  function teamIsArrived(team) {
    return state.arrival === 'both' || (state.arrival === 'a' && team === 'a');
  }

  function syncModeLabels() {
    document.querySelectorAll('[data-mode-label]').forEach(el => {
      el.textContent = state.mode;
    });
    document.querySelectorAll('[data-active-mode-label]').forEach(el => {
      el.textContent = activeModeLabel();
    });
    document.querySelectorAll('[data-mode-short]').forEach(el => {
      el.textContent = state.mode;
    });
  }

  function applyActiveLayoutClasses() {
    const count = activePlayerCount();
    elements.canvas.classList.toggle('layout-4v4', count === 4);
    elements.canvas.classList.toggle('layout-3v3', count === 3);
    elements.canvas.classList.toggle('layout-2v2', count === 2);
    elements.canvas.classList.toggle('mode-4v4', state.mode === '4v4');
    elements.canvas.classList.toggle('mode-3v3', state.mode === '3v3');
    elements.canvas.dataset.mode = state.mode;
    elements.canvas.dataset.baseMode = state.mode;
    elements.canvas.dataset.activeMode = `${count}v${count}`;
    elements.canvas.dataset.exLayout = isExActive() ? '1' : '0';
    elements.canvas.setAttribute(
      'aria-label',
      `1920×1080 OCLR S11 直播布局示意画布，当前场景：${SCENE_LABELS[state.scene]}，常规 ${state.mode}，当前 ${activeModeLabel()}`
    );
    document.body.dataset.mode = state.mode;
    document.body.dataset.activeMode = `${count}v${count}`;
  }

  function stageMeta() {
    return STAGE_META[state.stage] || STAGE_META.group;
  }

  function seriesTarget() {
    return stageMeta().target;
  }

  function currentFormat() {
    if (state.mapType === 'tb') {
      return 'tb';
    }
    return state.exTeam === 'none' ? 'normal' : 'ex';
  }

  function currentFormatLabel() {
    return FORMAT_LABELS[currentFormat()];
  }

  function currentMapMod() {
    return state.mapType === 'tb' ? 'TB' : state.mapMod;
  }

  function currentExLabel() {
    if (state.mapType === 'tb') {
      return 'TB · 禁 EX';
    }
    if (state.exTeam === 'none') {
      return 'EX 未开启';
    }
    return `EX · ${TEAM_NAMES[state.exTeam]}开启`;
  }

  function currentMapRule() {
    if (state.mapType === 'tb') {
      return '';
    }
    if (state.mapMod === 'FM') {
      return 'FM · 每队至少 1 名单HD（含 EZ/HDEZ） + 1 名单HR';
    }
    return '';
  }

  function orderLabel(value) {
    return value === 'unknown' ? '未确认' : TEAM_NAMES[value];
  }

  function banSlotLabel(value) {
    if (value === 'unknown') {
      return '未确认';
    }
    if (value === 'empty') {
      return '空Ban';
    }
    return value;
  }

  function pauseAvailabilityLabel(value) {
    return value === 'used' ? '已用' : '可用';
  }

  function rematchLabel(value) {
    if (value === 'available') {
      return '可确认';
    }
    if (value === 'used') {
      return '已用';
    }
    return '未确认';
  }

  function renderSeriesStars() {
    const target = seriesTarget();
    [
      [elements.seriesStarA, state.seriesA],
      [elements.seriesStarB, state.seriesB]
    ].forEach(([element, count]) => {
      if (!element) {
        return;
      }
      const filled = count === null ? 0 : count;
      element.textContent = Array.from({ length: target }, (_, index) => index < filled ? '★' : '☆').join(' ');
      element.setAttribute('aria-label', count === null ? '赢图未知' : `已赢 ${count} 图`);
    });
  }

  function updateHeader() {
    const meta = stageMeta();
    elements.stageLabelEls.forEach(el => {
      el.textContent = meta.label;
    });
    elements.seriesTargetEls.forEach(el => {
      el.textContent = `${meta.format} · 先 ${meta.target}`;
    });
    elements.formatLabelEls.forEach(el => {
      el.textContent = currentFormatLabel();
      el.dataset.format = currentFormat();
    });
    syncModeLabels();
    renderSeriesStars();
    elements.victoryStageEls.forEach(el => {
      el.textContent = meta.label;
    });
    elements.victoryTargetEls.forEach(el => {
      el.textContent = `${meta.format} · 先 ${meta.target}`;
    });
  }

  function syncSeriesOptions() {
    const target = seriesTarget();
    [
      [elements.seriesASelect, state.seriesA],
      [elements.seriesBSelect, state.seriesB]
    ].forEach(([select, value]) => {
      if (!select) {
        return;
      }
      const options = [['unknown', '未知']];
      for (let number = 0; number <= target; number += 1) {
        options.push([String(number), String(number)]);
      }
      select.innerHTML = options.map(([optionValue, label]) => `<option value="${optionValue}">${label}</option>`).join('');
      select.value = value === null ? 'unknown' : String(value);
    });
  }

  function banOptionsHtml() {
    const options = [
      ['unknown', '未确认'],
      ['empty', '空Ban'],
      ['NM', 'NM'],
      ['HD', 'HD'],
      ['HR', 'HR'],
      ['FM', 'FM'],
      ['TB', 'TB（不可 Ban）']
    ];
    return options.map(([value, label]) => `<option value="${value}"${value === 'TB' ? ' disabled' : ''}>${label}</option>`).join('');
  }

  function syncBanSlotSelects() {
    elements.banSlotSelects.forEach(select => {
      const key = select.dataset.banSlot;
      const team = key[0];
      const index = Number(key[1]);
      select.innerHTML = banOptionsHtml();
      const value = state.banSlots[team][index];
      select.value = BAN_STATES.includes(value) ? value : 'unknown';
    });
  }

  function syncS11Controls() {
    [elements.stageButtons, elements.mapTypeButtons, elements.pauseTypeButtons].forEach(group => {
      group.forEach(button => {
        button.classList.remove('is-active');
        button.setAttribute('aria-pressed', 'false');
      });
    });
    elements.stageButtons.forEach(button => {
      const active = button.dataset.stageTarget === state.stage;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    elements.mapTypeButtons.forEach(button => {
      const active = button.dataset.maptypeTarget === state.mapType;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    elements.pauseTypeButtons.forEach(button => {
      const active = button.dataset.pauseTypeTarget === state.pauseType;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    syncSeriesOptions();
    if (elements.mapModSelect) {
      elements.mapModSelect.value = state.mapMod;
      elements.mapModSelect.disabled = state.mapType === 'tb';
    }
    if (elements.exTeamSelect) {
      elements.exTeamSelect.value = state.exTeam;
      elements.exTeamSelect.disabled = state.mapType === 'tb';
    }
    if (elements.exRemainingA) {
      elements.exRemainingA.value = String(state.exA);
    }
    if (elements.exRemainingB) {
      elements.exRemainingB.value = String(state.exB);
    }
    if (elements.pickFirstSelect) {
      elements.pickFirstSelect.value = state.pickFirst;
    }
    if (elements.banFirstSelect) {
      elements.banFirstSelect.value = state.banFirst;
    }
    syncBanSlotSelects();
    if (elements.tacticalASelect) {
      elements.tacticalASelect.value = state.tacticalA;
    }
    if (elements.tacticalBSelect) {
      elements.tacticalBSelect.value = state.tacticalB;
    }
    if (elements.rematchASelect) {
      elements.rematchASelect.value = state.rematchA;
    }
    if (elements.rematchBSelect) {
      elements.rematchBSelect.value = state.rematchB;
    }
  }

  function updateMapInfo() {
    const format = currentFormatLabel();
    const mod = currentMapMod();
    const ex = currentExLabel();
    const rule = currentMapRule();
    elements.mapInfoFormats.forEach(el => {
      el.textContent = format;
    });
    elements.mapInfoMods.forEach(el => {
      el.textContent = mod;
    });
    elements.mapInfoEx.forEach(el => {
      el.textContent = ex;
    });
    elements.mapInfoRules.forEach(el => {
      el.textContent = rule;
      el.hidden = rule === '';
    });
  }

  function updateMappoolStatus() {
    elements.banSlotViews.forEach(el => {
      const key = el.dataset.banSlotView;
      const team = key[0];
      const index = Number(key[1]);
      const value = state.banSlots[team][index];
      el.textContent = banSlotLabel(value);
      const chip = el.closest('.ban-slot-chip');
      if (chip) {
        chip.dataset.state = value === 'empty' ? 'empty' : (BAN_STATES.includes(value) && !['unknown', 'empty'].includes(value) ? 'used' : 'unknown');
      }
    });
    elements.exRemainingViews.forEach(el => {
      el.textContent = String(el.dataset.exRemaining === 'a' ? state.exA : state.exB);
    });
    elements.pickFirstViews.forEach(el => {
      el.textContent = orderLabel(state.pickFirst);
    });
    elements.banFirstViews.forEach(el => {
      el.textContent = orderLabel(state.banFirst);
    });
    elements.mappoolFormatViews.forEach(el => {
      el.textContent = currentFormatLabel();
    });
    elements.mappoolModViews.forEach(el => {
      el.textContent = currentMapMod();
    });
    elements.mappoolExViews.forEach(el => {
      el.textContent = currentExLabel();
    });
  }

  function updatePause() {
    const tactical = state.pauseType === 'tactical';
    const typeLabel = tactical ? '战术暂停' : '技术处理';
    const headline = tactical ? '战术暂停' : '技术处理中';
    elements.pauseTitleEls.forEach(el => {
      el.textContent = tactical ? '战术暂停' : '技术处理中';
    });
    elements.pauseHeadlineEls.forEach(el => {
      el.textContent = headline;
    });
    elements.pauseTypeLabelEls.forEach(el => {
      el.textContent = typeLabel;
    });
    elements.pauseFooterTypeEls.forEach(el => {
      el.textContent = typeLabel;
    });
    elements.pauseDurationEls.forEach(el => {
      el.hidden = !tactical;
    });
    elements.pauseAStatusEls.forEach(el => {
      el.textContent = pauseAvailabilityLabel(state.tacticalA);
    });
    elements.pauseBStatusEls.forEach(el => {
      el.textContent = pauseAvailabilityLabel(state.tacticalB);
    });
    elements.rematchStatusEls.forEach(el => {
      el.textContent = `A ${rematchLabel(state.rematchA)} · B ${rematchLabel(state.rematchB)}`;
    });
  }

  function playerCardMarkup(team, player) {
    const teamName = TEAM_NAMES[team];
    const arrived = teamIsArrived(team);
    const playerId = player.id;
    const role = player.role;
    const slotNumber = player.slot;
    const statusText = arrived ? '已到场' : '等待中';
    const statusSymbol = arrived ? '✓' : '◇';
    const stateClass = arrived ? 'is-arrived' : 'is-waiting';
    const syntheticNote = player.syntheticEx ? 'EX 后排示例 · ' : '';

    return `
      <article class="player-card ${stateClass}" data-team="${team}" data-slot="${slotNumber}" data-player-id="${playerId}" data-synthetic-ex="${player.syntheticEx ? 'true' : 'false'}" data-arrival-state="${arrived ? 'arrived' : 'waiting'}" aria-label="${teamName}，${syntheticNote}选手${playerId}，${role}，${statusText}，就绪未确认">
        <div class="player-card-top">
          <span class="player-slot">${playerId} / SLOT ${String(slotNumber).padStart(2, '0')}</span>
          <span class="arrival-chip" aria-hidden="true">${statusSymbol} ${statusText}</span>
        </div>
        <div class="player-main">
          <span class="player-avatar" aria-hidden="true">${playerId}</span>
          <div class="player-copy">
            <p class="player-name">选手${playerId}<span class="role-chip">${role}</span></p>
            <p class="player-sub">${teamName} · ${syntheticNote}本场上场位 ${slotNumber} / ${activePlayerCount()}</p>
          </div>
        </div>
        <div class="player-bottom">
          <div class="player-status">
            <span>到场状态</span>
            <strong>${statusText}</strong>
          </div>
          <div class="player-status">
            <span>就绪状态</span>
            <strong>未确认</strong>
          </div>
        </div>
      </article>
    `;
  }

  function renderWaiting() {
    const count = activePlayerCount();

    ['a', 'b'].forEach(team => {
      const arrived = teamIsArrived(team);
      const arrivedCount = arrived ? count : 0;
      const teamName = TEAM_NAMES[team];
      const roster = document.querySelector(`[data-roster="${team}"]`);
      const countEl = document.querySelector(`[data-arrival-count="${team}"]`);

      roster.innerHTML = rosterForTeam(team)
        .map(player => playerCardMarkup(team, player))
        .join('');

      if (countEl) {
        countEl.textContent = `${arrivedCount} / ${count} 已到场`;
      }
      roster.setAttribute('aria-label', `${teamName} 上场槽位 ${arrivedCount} / ${count} 已到场`);
    });

    const total = count * 2;
    let arrivedTotal = 0;
    let headline = '等待选手到场';
    let copy = '等待双方选手入场。';
    let commentary = '等待双方选手入场。';

    if (state.arrival === 'a') {
      arrivedTotal = count;
      headline = '示例A队已到场';
      copy = '示例B队等待中。';
      commentary = '示例A队已到场，示例B队等待中。';
    } else if (state.arrival === 'both') {
      arrivedTotal = total;
      headline = '双方选手已到场';
      copy = '等待就绪确认。';
      commentary = '双方选手已到场，等待就绪。';
    }

    elements.readinessHeadline.textContent = headline;
    elements.readinessCount.textContent = `${arrivedTotal} / ${total}`;
    elements.readinessCopy.textContent = copy;
    if (elements.waitingCommentary) {
      elements.waitingCommentary.textContent = commentary;
    }
    syncModeLabels();
  }

  function renderPlaying() {
    const cards = [];
    const count = activePlayerCount();

    ['a', 'b'].forEach(team => {
      rosterForTeam(team).forEach(player => {
        cards.push(`
          <article class="pov-cell" data-team="${team}" data-slot="${player.slot}" data-player="${player.id}" aria-label="${TEAM_NAMES[team]} ${player.syntheticEx ? 'EX 后排示例 ' : ''}选手${player.id} ${player.role} 游戏画面占位">
            <div class="pov-frame">
              <div class="pov-source"><span>游戏画面占位</span></div>
            </div>
            <div class="pov-label">
              <span class="pov-player">${player.id}</span>
              <span class="pov-name">${TEAM_NAMES[team]} · 选手${player.id}<span class="role-chip role-chip--pov">${player.role}</span></span>
            </div>
          </article>
        `);
      });
    });

    elements.playfield.innerHTML = cards.join('');
    elements.playfield.setAttribute(
      'aria-label',
      isExActive()
        ? `EX ${count} 对 ${count}，${count * 2} 路上场选手游戏画面占位`
        : (count === 4
          ? '四对四，八路上场选手游戏画面占位'
          : '三对三候选，六路上场选手游戏画面占位')
    );
  }

  function renderMapResult() {
    const count = activePlayerCount();
    const cards = [];

    ['a', 'b'].forEach(team => {
      rosterForTeam(team).forEach(player => {
        cards.push(`
          <article class="pov-cell" data-team="${team}" data-slot="${player.slot}" data-player="${player.id}" aria-label="${TEAM_NAMES[team]} ${player.syntheticEx ? 'EX 后排示例 ' : ''}选手${player.id} ${player.role}，osu!原生结算画面占位">
            <div class="pov-frame">
              <div class="pov-source pov-source--result">
                <span class="result-source-title">osu!原生结算画面</span>
                <span class="result-source-meta">Accuracy · Score · 100 · 50 · Miss</span>
              </div>
            </div>
            <div class="pov-label">
              <span class="pov-player">${player.id}</span>
              <span class="pov-name">${TEAM_NAMES[team]} · 选手${player.id}<span class="role-chip role-chip--pov">${player.role}</span></span>
            </div>
          </article>
        `);
      });
    });

    const totalA = RESULT_PLAYER_SCORES.a.slice(0, count).reduce((sum, value) => sum + value, 0);
    const totalB = RESULT_PLAYER_SCORES.b.slice(0, count).reduce((sum, value) => sum + value, 0);
    const displayA = totalA.toLocaleString('en-US');
    const displayB = totalB.toLocaleString('en-US');

    elements.resultPlayfield.innerHTML = cards.join('');
    elements.resultPlayfield.setAttribute(
      'aria-label',
      isExActive()
        ? `EX ${count} 对 ${count}，${count * 2} 路单图结算画面占位`
        : (count === 4
          ? '四对四，八路单图结算画面占位'
          : '三对三，六路单图结算画面占位')
    );
    elements.resultScoreStage.dataset.lead = 'left-small';
    elements.resultScoreStage.setAttribute(
      'aria-label',
      `示例A队 队伍总分 ${displayA}，示例B队 队伍总分 ${displayB}`
    );
    elements.resultTotalA.textContent = displayA;
    elements.resultTotalB.textContent = displayB;
  }

  function renderLineupScenes() {
    applyActiveLayoutClasses();
    renderWaiting();
    renderPlaying();
    renderMapResult();
  }

  function mapStatusFor(index) {
    return index === 0
      ? { type: state.map, label: MAP_LABELS[state.map], icon: MAP_ICONS[state.map] }
      : { type: 'open', label: MAP_LABELS.open, icon: MAP_ICONS.open };
  }

  function renderMappool() {
    let mapIndex = 0;
    const columns = MAP_GROUPS.map(group => {
      const entries = Array.from({ length: 6 }, () => {
        const index = mapIndex;
        mapIndex += 1;
        const mapNumber = String(index + 1).padStart(2, '0');
        const status = mapStatusFor(index);
        const statusClass = `state-${status.type}`;
        const entryClass = status.type === 'open' ? '' : ` is-${status.type}`;
        const mod = MAP_ROW_MODS[index] || 'NM';

        return `
          <li class="map-entry${entryClass}" data-map-index="${index}" data-map-state="${status.type}">
            <span class="map-index" aria-hidden="true">${mapNumber}</span>
            <span class="map-mod" aria-hidden="true">${mod}</span>
            <span class="map-copy">
              <span class="map-title">谱面标题占位 ${group.code}-${mapNumber}</span>
              <span class="map-meta">艺术家 / 难度</span>
            </span>
            <span class="map-status ${statusClass}"><span aria-hidden="true">${status.icon}</span> ${status.label}</span>
          </li>
        `;
      }).join('');

      return `
        <article class="mappool-column" aria-label="${group.label}，谱面列表占位">
          <header class="map-group-head">
            <strong>${group.label}</strong>
          </header>
          <ol class="map-list">${entries}</ol>
        </article>
      `;
    }).join('');

    elements.mappoolColumns.innerHTML = columns;
    elements.mapReadout.textContent = MAP_LABELS[state.map];
    elements.mapCycleButton.setAttribute(
      'aria-label',
      `切换焦点谱面状态；当前为${MAP_LABELS[state.map]}`
    );
  }

  function updateModeControls() {
    modeButtons.forEach(button => {
      const active = button.dataset.modeTarget === state.mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function updateSourceControls() {
    sourceButtons.forEach(button => {
      const active = button.dataset.sourceTarget === state.source;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    elements.canvas.classList.toggle('source-4x3', state.source === '4x3');
    elements.canvas.classList.toggle('source-16x9', state.source === '16x9');
    elements.canvas.dataset.source = state.source;
    document.body.dataset.source = state.source;
  }

  function updateLeadControls() {
    leadButtons.forEach(button => {
      const active = button.dataset.leadTarget === state.lead;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const demo = LEAD_DEMOS[state.lead];
    elements.scoreStage.dataset.lead = state.lead;
    elements.scoreValueA.textContent = demo.a;
    elements.scoreValueB.textContent = demo.b;
    elements.scoreStage.setAttribute(
      'aria-label',
      `示例A队 ${demo.a}，示例B队 ${demo.b}`
    );
    document.body.dataset.lead = state.lead;
  }

  function updateArrivalControls() {
    arrivalButtons.forEach(button => {
      const active = button.dataset.arrival === state.arrival;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function updateSceneVisibility() {
    scenePanels.forEach(panel => {
      const active = panel.dataset.scenePanel === state.scene;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });

    sceneButtons.forEach(button => {
      const active = button.dataset.sceneTarget === state.scene;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    document.querySelectorAll('[data-header-scene]').forEach(el => {
      el.textContent = SCENE_LABELS[state.scene];
    });

    document.body.dataset.scene = state.scene;
    elements.canvas.dataset.currentScene = state.scene;
    elements.canvas.setAttribute(
      'aria-label',
      `1920×1080 OCLR S11 直播布局示意画布，当前场景：${SCENE_LABELS[state.scene]}，常规 ${state.mode}，当前 ${activeModeLabel()}`
    );
  }

  function updateCleanControls() {
    document.body.classList.toggle('is-clean', state.clean);
    elements.cleanButton.setAttribute('aria-pressed', String(state.clean));
    elements.cleanButton.textContent = state.clean ? '退出干净输出' : '进入干净输出';
    document.body.dataset.clean = state.clean ? 'true' : 'false';
    document.title = state.clean
      ? '干净输出 · Esc 退出 · OCLR S11 布局评审'
      : 'OCLR S11 直播 UI · 空间布局评审';
  }

  function renderAll() {
    updateModeControls();
    updateSourceControls();
    updateLeadControls();
    updateArrivalControls();
    updateSceneVisibility();
    updateCleanControls();
    renderLineupScenes();
    renderMappool();
    elements.mapReadout.textContent = MAP_LABELS[state.map];
    updateHeader();
    syncS11Controls();
    updateMapInfo();
    updateMappoolStatus();
    updatePause();
  }

  function setScene(scene) {
    if (!SCENES.includes(scene) || scene === state.scene) {
      return;
    }
    state.scene = scene;
    updateSceneVisibility();
    writeLocationState();
  }

  function setMode(mode) {
    if (!Object.prototype.hasOwnProperty.call(TEAM_COUNTS, mode) || mode === state.mode) {
      return;
    }
    state.mode = mode;
    updateModeControls();
    renderLineupScenes();
    writeLocationState();
  }

  function setStage(stage) {
    if (!STAGES.includes(stage) || stage === state.stage) {
      return;
    }
    state.stage = stage;
    const target = seriesTarget();
    if (state.seriesA !== null && state.seriesA > target) {
      state.seriesA = null;
    }
    if (state.seriesB !== null && state.seriesB > target) {
      state.seriesB = null;
    }
    updateHeader();
    syncS11Controls();
    writeLocationState();
  }

  function setMapType(mapType) {
    if (!MAP_TYPES.includes(mapType) || mapType === state.mapType) {
      return;
    }
    state.mapType = mapType;
    if (mapType === 'tb') {
      state.exTeam = 'none';
    }
    renderLineupScenes();
    updateHeader();
    syncS11Controls();
    updateMapInfo();
    updateMappoolStatus();
    writeLocationState();
  }

  function setMapMod(mapMod) {
    if (!MAP_MODS.includes(mapMod) || mapMod === state.mapMod) {
      return;
    }
    state.mapMod = mapMod;
    updateMapInfo();
    updateMappoolStatus();
    writeLocationState();
  }

  function setExTeam(team) {
    if (!EX_TEAMS.includes(team) || state.mapType === 'tb' || team === state.exTeam) {
      return;
    }
    state.exTeam = team;
    renderLineupScenes();
    updateHeader();
    updateMapInfo();
    updateMappoolStatus();
    writeLocationState();
  }

  function setExRemaining(team, value) {
    const count = Number(value);
    if (![0, 1, 2].includes(count)) {
      return;
    }
    if (team === 'a') {
      state.exA = count;
    } else {
      state.exB = count;
    }
    updateMappoolStatus();
    writeLocationState();
  }

  function setFirstOrder(kind, value) {
    if (!ORDER_STATES.includes(value)) {
      return;
    }
    if (kind === 'pick') {
      state.pickFirst = value;
    } else {
      state.banFirst = value;
    }
    updateMappoolStatus();
    writeLocationState();
  }

  function setSeries(team, value) {
    const parsed = parseSeriesValue(value, seriesTarget());
    if (team === 'a') {
      state.seriesA = parsed;
    } else {
      state.seriesB = parsed;
    }
    updateHeader();
    writeLocationState();
  }

  function setBanSlot(key, value) {
    const team = key[0];
    const index = Number(key[1]);
    const select = elements.banSlotSelects.find(el => el.dataset.banSlot === key);
    const previous = state.banSlots[team][index];

    if (value === 'TB') {
      elements.bpFeedback.textContent = 'TB 不可 Ban，已阻止该选择。';
      if (select) select.value = previous;
      return;
    }

    const other = state.banSlots[team][1 - index];
    if (['HD', 'HR'].includes(value) && value === other) {
      elements.bpFeedback.textContent = `${TEAM_NAMES[team]} 同一 mod 不可重复 Ban（NM/FM 例外），已阻止 ${value}。`;
      if (select) select.value = previous;
      return;
    }

    if (!BAN_STATES.includes(value)) {
      if (select) select.value = previous;
      return;
    }

    state.banSlots[team][index] = value;
    const slotName = `Ban ${index + 1}`;
    if (value === 'empty') {
      elements.bpFeedback.textContent = `${TEAM_NAMES[team]} ${slotName}：空 Ban（本地演示）。`;
    } else if (value === 'unknown') {
      elements.bpFeedback.textContent = `${TEAM_NAMES[team]} ${slotName}：未确认。`;
    } else {
      elements.bpFeedback.textContent = `${TEAM_NAMES[team]} ${slotName}：${value}（本地演示）。`;
    }
    updateMappoolStatus();
    writeLocationState();
  }

  function setPauseType(pauseType) {
    if (!PAUSE_TYPES.includes(pauseType) || pauseType === state.pauseType) {
      return;
    }
    state.pauseType = pauseType;
    updatePause();
    syncS11Controls();
    writeLocationState();
  }

  function setTacticalAvailability(team, value) {
    if (!PAUSE_AVAILABILITY.includes(value)) {
      return;
    }
    if (team === 'a') {
      state.tacticalA = value;
    } else {
      state.tacticalB = value;
    }
    updatePause();
    writeLocationState();
  }

  function setRematch(team, value) {
    if (!REMATCH_STATES.includes(value)) {
      return;
    }
    if (team === 'a') {
      state.rematchA = value;
    } else {
      state.rematchB = value;
    }
    updatePause();
    writeLocationState();
  }

  function setSource(source) {
    if (!Object.prototype.hasOwnProperty.call(SOURCE_RATIOS, source) || source === state.source) {
      return;
    }
    state.source = source;
    updateSourceControls();
    writeLocationState();
  }

  function setLead(lead) {
    if (!LEAD_STATES.includes(lead) || lead === state.lead) {
      return;
    }
    state.lead = lead;
    updateLeadControls();
    writeLocationState();
  }

  function setArrival(arrival) {
    if (!ARRIVAL_STATES.includes(arrival) || arrival === state.arrival) {
      return;
    }
    state.arrival = arrival;
    updateArrivalControls();
    renderWaiting();
    writeLocationState();
  }

  function cycleMapState() {
    const currentIndex = MAP_ORDER.indexOf(state.map);
    state.map = MAP_ORDER[(currentIndex + 1) % MAP_ORDER.length];
    renderMappool();
    writeLocationState();
  }

  function toggleClean() {
    state.clean = !state.clean;
    updateCleanControls();
    if (state.clean && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    writeLocationState();
    scheduleFit();
  }

  function scheduleFit() {
    if (fitFrame) {
      window.cancelAnimationFrame(fitFrame);
    }
    fitFrame = window.requestAnimationFrame(() => {
      fitFrame = 0;
      fitCanvas();
    });
  }

  function fitCanvas() {
    const stage = elements.canvasStage;
    if (!stage) {
      return;
    }

    const styles = window.getComputedStyle(stage);
    const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const availableWidth = Math.max(0, stage.clientWidth - horizontalPadding);
    const availableHeight = Math.max(0, stage.clientHeight - verticalPadding);
    const scale = Math.max(
      0.001,
      Math.min(availableWidth / CANVAS_WIDTH, availableHeight / CANVAS_HEIGHT)
    );

    elements.canvasSizer.style.width = `${CANVAS_WIDTH * scale}px`;
    elements.canvasSizer.style.height = `${CANVAS_HEIGHT * scale}px`;
    elements.canvas.style.transform = `scale(${scale})`;
  }

  function bindEvents() {
    sceneButtons.forEach(button => {
      button.addEventListener('click', () => setScene(button.dataset.sceneTarget));
    });

    modeButtons.forEach(button => {
      button.addEventListener('click', () => setMode(button.dataset.modeTarget));
    });

    sourceButtons.forEach(button => {
      button.addEventListener('click', () => setSource(button.dataset.sourceTarget));
    });

    leadButtons.forEach(button => {
      button.addEventListener('click', () => setLead(button.dataset.leadTarget));
    });

    arrivalButtons.forEach(button => {
      button.addEventListener('click', () => setArrival(button.dataset.arrival));
    });

    elements.stageButtons.forEach(button => {
      button.addEventListener('click', () => setStage(button.dataset.stageTarget));
    });

    elements.mapTypeButtons.forEach(button => {
      button.addEventListener('click', () => setMapType(button.dataset.maptypeTarget));
    });

    elements.pauseTypeButtons.forEach(button => {
      button.addEventListener('click', () => setPauseType(button.dataset.pauseTypeTarget));
    });

    elements.seriesASelect.addEventListener('change', event => setSeries('a', event.target.value));
    elements.seriesBSelect.addEventListener('change', event => setSeries('b', event.target.value));
    elements.mapModSelect.addEventListener('change', event => setMapMod(event.target.value));
    elements.exTeamSelect.addEventListener('change', event => setExTeam(event.target.value));
    elements.exRemainingA.addEventListener('change', event => setExRemaining('a', event.target.value));
    elements.exRemainingB.addEventListener('change', event => setExRemaining('b', event.target.value));
    elements.pickFirstSelect.addEventListener('change', event => setFirstOrder('pick', event.target.value));
    elements.banFirstSelect.addEventListener('change', event => setFirstOrder('ban', event.target.value));

    elements.banSlotSelects.forEach(select => {
      select.addEventListener('change', event => setBanSlot(select.dataset.banSlot, event.target.value));
    });

    elements.tacticalASelect.addEventListener('change', event => setTacticalAvailability('a', event.target.value));
    elements.tacticalBSelect.addEventListener('change', event => setTacticalAvailability('b', event.target.value));
    elements.rematchASelect.addEventListener('change', event => setRematch('a', event.target.value));
    elements.rematchBSelect.addEventListener('change', event => setRematch('b', event.target.value));

    elements.mapCycleButton.addEventListener('click', cycleMapState);
    elements.cleanButton.addEventListener('click', toggleClean);

    window.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) {
        return;
      }

      if (/^[1-6]$/.test(event.key)) {
        event.preventDefault();
        setScene(SCENES[Number(event.key) - 1]);
        return;
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        toggleClean();
        return;
      }

      if (event.key === 'Escape' && state.clean) {
        event.preventDefault();
        toggleClean();
      }
    });

    const handleLocationChange = () => {
      if (!locationListenerActive) {
        return;
      }
      const next = readLocationState();
      if (statesMatch(next, state)) {
        return;
      }
      Object.assign(state, next);
      renderAll();
      scheduleFit();
    };

    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('resize', scheduleFit);

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(scheduleFit);
      observer.observe(elements.canvasStage);
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(scheduleFit);
    }

    window.addEventListener('load', scheduleFit, { once: true });
  }

  function init() {
    Object.assign(state, readLocationState());
    bindEvents();
    renderAll();
    scheduleFit();
  }

  init();
})();
