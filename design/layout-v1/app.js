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
    map: 'banned'
  };

  const elements = {
    canvas: document.getElementById('broadcastCanvas'),
    canvasStage: document.getElementById('canvasStage'),
    canvasSizer: document.getElementById('canvasSizer'),
    chrome: document.getElementById('reviewChrome'),
    cleanButton: document.getElementById('cleanButton'),
    mapCycleButton: document.getElementById('mapCycleButton'),
    mapReadout: document.getElementById('mapReadout'),
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

    return {
      scene: firstKnown(scene, SCENES, 'waiting'),
      mode: firstKnown(getValue('mode'), Object.keys(TEAM_COUNTS), '4v4'),
      source: firstKnown(getValue('source'), Object.keys(SOURCE_RATIOS), '4x3'),
      lead: normalizeLeadState(getValue('lead')),
      clean,
      arrival: firstKnown(getValue('arrival'), ARRIVAL_STATES, 'none'),
      map: firstKnown(getValue('map'), MAP_STATES, 'banned')
    };
  }

  function statesMatch(a, b) {
    return a.scene === b.scene &&
      a.mode === b.mode &&
      a.source === b.source &&
      a.lead === b.lead &&
      a.clean === b.clean &&
      a.arrival === b.arrival &&
      a.map === b.map;
  }

  function writeLocationState() {
    const hash = new URLSearchParams({
      scene: state.scene,
      mode: state.mode,
      source: state.source,
      lead: state.lead,
      clean: state.clean ? '1' : '0',
      arrival: state.arrival,
      map: state.map
    });

    const nextUrl = new URL(window.location.href);
    ['scene', 'mode', 'source', 'lead', 'clean', 'arrival', 'map'].forEach(key => {
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

  function countForMode() {
    return TEAM_COUNTS[state.mode] || 4;
  }

  function rosterForTeam(team) {
    const count = countForMode();
    return Array.from({ length: count }, (_, index) => `${team.toUpperCase()}${index + 1}`);
  }

  function teamIsArrived(team) {
    return state.arrival === 'both' || (state.arrival === 'a' && team === 'a');
  }

  function syncModeLabels() {
    document.querySelectorAll('[data-mode-label]').forEach(el => {
      el.textContent = state.mode;
    });
    document.querySelectorAll('[data-mode-short]').forEach(el => {
      el.textContent = state.mode;
    });
  }

  function playerCardMarkup(team, playerId, index) {
    const teamName = TEAM_NAMES[team];
    const arrived = teamIsArrived(team);
    const slotNumber = index + 1;
    const statusText = arrived ? '已到场' : '等待中';
    const statusSymbol = arrived ? '✓' : '◇';
    const stateClass = arrived ? 'is-arrived' : 'is-waiting';

    return `
      <article class="player-card ${stateClass}" data-player-id="${playerId}" data-arrival-state="${arrived ? 'arrived' : 'waiting'}" aria-label="${teamName}，选手${playerId}，${statusText}，就绪未确认">
        <div class="player-card-top">
          <span class="player-slot">${playerId} / SLOT ${String(slotNumber).padStart(2, '0')}</span>
          <span class="arrival-chip" aria-hidden="true">${statusSymbol} ${statusText}</span>
        </div>
        <div class="player-main">
          <span class="player-avatar" aria-hidden="true">${playerId}</span>
          <div class="player-copy">
            <p class="player-name">选手${playerId}</p>
            <p class="player-sub">${teamName} · 本场上场位 ${slotNumber} / ${countForMode()}</p>
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
    const count = countForMode();

    ['a', 'b'].forEach(team => {
      const arrived = teamIsArrived(team);
      const arrivedCount = arrived ? count : 0;
      const teamName = TEAM_NAMES[team];
      const roster = document.querySelector(`[data-roster="${team}"]`);
      const countEl = document.querySelector(`[data-arrival-count="${team}"]`);

      roster.innerHTML = rosterForTeam(team)
        .map((playerId, index) => playerCardMarkup(team, playerId, index))
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

    ['a', 'b'].forEach(team => {
      rosterForTeam(team).forEach(playerId => {
        cards.push(`
          <article class="pov-cell" data-player="${playerId}" aria-label="${TEAM_NAMES[team]} 选手${playerId} 游戏画面占位">
            <div class="pov-frame">
              <div class="pov-source"><span>游戏画面占位</span></div>
            </div>
            <div class="pov-label">
              <span class="pov-player">${playerId}</span>
              <span class="pov-name">${TEAM_NAMES[team]} · 选手${playerId}</span>
            </div>
          </article>
        `);
      });
    });

    elements.playfield.innerHTML = cards.join('');
    elements.playfield.setAttribute(
      'aria-label',
      state.mode === '4v4'
        ? '四对四，八路上场选手游戏画面占位'
        : '三对三候选，六路上场选手游戏画面占位'
    );

    elements.canvas.classList.toggle('mode-4v4', state.mode === '4v4');
    elements.canvas.classList.toggle('mode-3v3', state.mode === '3v3');
    elements.canvas.dataset.mode = state.mode;
    document.body.dataset.mode = state.mode;
  }

  function renderMapResult() {
    const count = countForMode();
    const cards = [];

    ['a', 'b'].forEach(team => {
      rosterForTeam(team).forEach(playerId => {
        cards.push(`
          <article class="pov-cell" data-player="${playerId}" aria-label="${TEAM_NAMES[team]} 选手${playerId}，osu!原生结算画面占位">
            <div class="pov-frame">
              <div class="pov-source pov-source--result">
                <span class="result-source-title">osu!原生结算画面</span>
                <span class="result-source-meta">Accuracy · Score · 100 · 50 · Miss</span>
              </div>
            </div>
            <div class="pov-label">
              <span class="pov-player">${playerId}</span>
              <span class="pov-name">${TEAM_NAMES[team]} · 选手${playerId}</span>
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
      count === 4 ? '四对四，八路单图结算画面占位' : '三对三，六路单图结算画面占位'
    );
    elements.resultScoreStage.dataset.lead = 'left-small';
    elements.resultScoreStage.setAttribute(
      'aria-label',
      `示例A队 队伍总分 ${displayA}，示例B队 队伍总分 ${displayB}`
    );
    elements.resultTotalA.textContent = displayA;
    elements.resultTotalB.textContent = displayB;
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

        return `
          <li class="map-entry${entryClass}" data-map-index="${index}" data-map-state="${status.type}">
            <span class="map-index" aria-hidden="true">${mapNumber}</span>
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
      `1920×1080 OCLR 直播布局示意画布，当前场景：${SCENE_LABELS[state.scene]}`
    );
  }

  function updateCleanControls() {
    document.body.classList.toggle('is-clean', state.clean);
    elements.cleanButton.setAttribute('aria-pressed', String(state.clean));
    elements.cleanButton.textContent = state.clean ? '退出干净输出' : '进入干净输出';
    document.body.dataset.clean = state.clean ? 'true' : 'false';
    document.title = state.clean
      ? '干净输出 · Esc 退出 · OCLR直播UI布局规划'
      : 'OCLR直播UI布局规划';
  }

  function renderAll() {
    updateModeControls();
    updateSourceControls();
    updateLeadControls();
    updateArrivalControls();
    updateSceneVisibility();
    updateCleanControls();
    renderWaiting();
    renderPlaying();
    renderMapResult();
    renderMappool();
    elements.mapReadout.textContent = MAP_LABELS[state.map];
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
    syncModeLabels();
    renderWaiting();
    renderPlaying();
    renderMapResult();
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
