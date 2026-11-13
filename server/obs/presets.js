import { ObsError } from './socket.js';

export const presetScenes = { regular: 'OCLR · 常规 4v4', ex: 'OCLR · EX 3v3' };
export const slots = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'];
export const exPositions = slots.filter(slot => !slot.endsWith('4'));
const browser = 'OCLR · 比赛画面';
const desktopKind = 'wasapi_output_capture';
const desktopName = 'OCLR · 桌面音频';
export const capture = slot => `OCLR · 捕获 ${slot}`;
const sources = [...slots.map(capture), browser];
const layouts = Object.keys(presetScenes);

export function captureTransform(position, source, ex) {
  const n = Number(position[1]) - 1;
  return {
    alignment: 5, positionX: (position[0] === 'B' ? 960 : 0) + (ex && n === 2 ? 240 : (n % 2) * 480),
    positionY: (n < 2 ? 180 : 540) + (source === '16x9' ? 45 : 0),
    boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 0, boundsWidth: 480, boundsHeight: source === '16x9' ? 270 : 360,
  };
}

export async function newPreset(call) {
  const { baseWidth, baseHeight } = await call('GetVideoSettings');
  if (baseWidth !== 1920 || baseHeight !== 1080) throw new ObsError('请在 OBS 的视频设置中将基础画布设为 1920×1080，再创建场景。');
  const { inputKinds } = await call('GetInputKindList');
  const kind = ['game_capture', 'window_capture'].find(name => inputKinds.includes(name));
  if (!kind || !inputKinds.includes('browser_source')) throw new ObsError('创建预设需要 Windows OBS 的游戏捕获或窗口捕获，以及浏览器源。也可以绑定已有场景。');
  const { scenes } = await call('GetSceneList');
  const { inputs } = await call('GetInputList');
  const { groups } = await call('GetGroupList');
  const occupied = new Set([...scenes.map(s => s.sceneName), ...inputs.map(i => i.inputName), ...groups]);
  const collision = [...Object.values(presetScenes), ...sources].find(name => occupied.has(name));
  if (collision) throw new ObsError(`「${collision}」已存在。请选择已有场景，或在 OBS 中改名后再创建。`);
  return { ready: false, kind, sceneIds: {}, lineup: [...exPositions], manualEmpty: [], appliedSource: null };
}

function itemId(items, name) {
  const matches = items.filter(item => item.sourceName === name);
  if (matches.length !== 1) throw new ObsError(`请在 OBS 中核对「${name}」，每个比赛场景应有一项此来源。`);
  return matches[0].sceneItemId;
}

function layoutsToBuild(preset, scenes) {
  const pending = new Set(preset.pendingLayouts ?? (preset.ready ? [] : layouts));
  for (const [layout, sceneName] of Object.entries(presetScenes)) {
    const existing = scenes.find(scene => scene.sceneName === sceneName);
    const uuid = preset.sceneIds[layout];
    if (!existing) {
      const renamed = uuid && scenes.find(scene => scene.sceneUuid === uuid);
      if (renamed) throw new ObsError(`「${sceneName}」已改名为「${renamed.sceneName}」，请在控制台重新绑定，或在 OBS 恢复原名。`);
      pending.add(layout);
    } else if (!Object.hasOwn(preset.sceneIds, layout) || (uuid && uuid !== existing.sceneUuid)) {
      throw new ObsError(`「${sceneName}」已被其他场景占用，请直接绑定或在 OBS 中改名。`);
    }
  }
  return layouts.filter(layout => pending.has(layout));
}

function sceneTarget(layout, ids) {
  return ids[layout] ? { sceneUuid: ids[layout] } : { sceneName: presetScenes[layout] };
}

// The previous portable package recorded scene IDs only. If both scenes were
// deleted, an input may still be in use elsewhere; verify its preset settings before reusing it.
async function matchesLegacyInput(call, input, overlayUrl) {
  const { inputSettings } = await call('GetInputSettings', { inputName: input.inputName });
  if (input.inputName === browser) return inputSettings.url === overlayUrl && inputSettings.width === 1920 && inputSettings.height === 1080;
  return inputSettings.priority === 1 && inputSettings.capture_cursor === false && inputSettings.cursor === false &&
    (input.inputKind !== 'game_capture' || inputSettings.capture_mode === 'window');
}

export async function buildPreset(call, preset, overlayUrl, source, checkpoint) {
  const { scenes } = await call('GetSceneList');
  const pending = layoutsToBuild(preset, scenes);
  if (!pending.length) return preset;

  const { inputs } = await call('GetInputList');
  const { groups } = await call('GetGroupList');
  const byName = new Map(inputs.map(input => [input.inputName, input]));
  const sceneIds = { ...preset.sceneIds };
  const inputIds = { ...preset.inputIds };
  const itemsByLayout = new Map();
  const linked = new Set();
  for (const layout of layouts) {
    const scene = scenes.find(s => s.sceneName === presetScenes[layout]);
    if (!scene) continue;
    sceneIds[layout] = scene.sceneUuid || null;
    const { sceneItems } = await call('GetSceneItemList', sceneTarget(layout, sceneIds));
    itemsByLayout.set(layout, sceneItems);
    for (const item of sceneItems) linked.add(item.sourceName);
  }
  // Older profiles identify shared inputs through the surviving preset scene.
  // Check both layouts and their names before writing anything to OBS.
  const occupied = new Set([...scenes.map(s => s.sceneName), ...groups]);
  const collision = sources.find(name => occupied.has(name)) ??
    pending.map(layout => presetScenes[layout]).find(name => groups.includes(name) || byName.has(name));
  if (collision) throw new ObsError(`「${collision}」的名称已被占用，请在 OBS 中改名后再点「创建比赛场景」。`);
  for (const name of sources) {
    const input = byName.get(name);
    if (!input) {
      const renamed = inputIds[name] && inputs.find(other => other.inputUuid === inputIds[name]);
      if (renamed) throw new ObsError(`「${name}」已改名为「${renamed.inputName}」，请在 OBS 恢复原名后再点「创建比赛场景」。`);
      delete inputIds[name]; // A retry can recognize its replacement through the scene we create below.
      continue;
    }
    const expectedKind = name === browser ? 'browser_source' : preset.kind;
    const savedId = inputIds[name];
    let owned = savedId ? savedId === input.inputUuid : linked.has(name);
    if (!owned && !savedId && (preset.ready || Object.hasOwn(inputIds, name)) && input.inputKind === expectedKind) {
      owned = await matchesLegacyInput(call, input, overlayUrl);
    }
    if (!owned || input.inputKind !== expectedKind) {
      throw new ObsError(`「${name}」与原预设来源不符，请在 OBS 中给该来源改名后再点「创建比赛场景」。`);
    }
    inputIds[name] = input.inputUuid || null;
  }

  const remaining = new Set(pending);
  const pendingLocks = { ...preset.pendingLocks };
  const appliedSource = pending.length === layouts.length ? source : preset.appliedSource;
  const saveProgress = () => checkpoint({
    ...preset, ready: false, pendingLayouts: [...remaining], pendingLocks: { ...pendingLocks },
    appliedSource, sceneIds: { ...sceneIds }, inputIds: { ...inputIds },
  });
  await saveProgress();
  for (const layout of pending) {
    let sceneItems = itemsByLayout.get(layout);
    if (!sceneItems) {
      const result = await call('CreateScene', { sceneName: presetScenes[layout] });
      sceneIds[layout] = result.sceneUuid || null;
      await saveProgress();
      sceneItems = [];
    }
    const target = sceneTarget(layout, sceneIds);
    const missing = sources.filter(name => !sceneItems.some(item => item.sourceName === name));
    pendingLocks[layout] = [...new Set([...(pendingLocks[layout] ?? []), ...missing])];
    await saveProgress();
    for (const name of missing) {
      const overlay = name === browser;
      if (byName.has(name)) {
        const input = inputIds[name] ? { sourceUuid: inputIds[name] } : { sourceName: name };
        await call('CreateSceneItem', { ...target, ...input, sceneItemEnabled: false });
      } else {
        const kind = overlay ? 'browser_source' : preset.kind;
        const inputSettings = overlay ? { url: overlayUrl, width: 1920, height: 1080, shutdown: false, restart_when_active: false }
          : { ...(kind === 'game_capture' ? { capture_mode: 'window' } : {}), window: '', priority: 1, capture_cursor: false, cursor: false, capture_audio: false };
        const result = await call('CreateInput', { ...target, inputName: name, inputKind: kind, inputSettings, sceneItemEnabled: false });
        inputIds[name] = result.inputUuid || null;
        byName.set(name, result);
      }
    }
    const { sceneItems: items } = await call('GetSceneItemList', target);
    const overlay = { ...target, sceneItemId: itemId(items, browser) };
    await call('SetSceneItemTransform', { ...overlay, sceneItemTransform: { alignment: 5, positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, boundsType: 'OBS_BOUNDS_NONE' } });
    await call('SetSceneItemIndex', { ...overlay, sceneItemIndex: items.length - 1 });
    await call('SetSceneItemEnabled', { ...overlay, sceneItemEnabled: true });
    await arrangeCaptures(call, { ...preset, sceneIds }, source, [layout]);
    // Save each completed lock so a retry cannot relock an item the operator unlocked.
    for (const name of pendingLocks[layout]) {
      await call('SetSceneItemLocked', { ...target, sceneItemId: itemId(items, name), sceneItemLocked: true });
      pendingLocks[layout] = pendingLocks[layout].slice(1);
      await saveProgress();
    }
    delete pendingLocks[layout];
    remaining.delete(layout);
    if (remaining.size) await saveProgress();
  }
  return { ...preset, sceneIds, inputIds, ready: true, pendingLayouts: [], pendingLocks: {}, appliedSource,
    lineupDirty: pending.includes('ex') ? false : preset.lineupDirty };
}

async function availableDesktopName(call, inputs) {
  const { inputKinds } = await call('GetInputKindList');
  if (!inputKinds.includes(desktopKind)) throw new ObsError('OBS 缺少音频输出采集。请在 OBS 的「设置 → 音频」启用桌面音频，再点「创建比赛场景」。');
  const { scenes } = await call('GetSceneList');
  const { groups } = await call('GetGroupList');
  const usedNames = new Set([...inputs.map(i => i.inputName), ...scenes.map(s => s.sceneName), ...groups]);
  let inputName = desktopName;
  for (let n = 2; usedNames.has(inputName); n++) inputName = `${desktopName} (${n})`;
  return inputName;
}

async function placeDesktopItem(call, target, sceneItemId) {
  const item = { ...target, sceneItemId };
  await call('SetSceneItemIndex', { ...item, sceneItemIndex: 0 });
  await call('SetSceneItemLocked', { ...item, sceneItemLocked: true });
}

// Global desktop devices already feed every scene. When none is configured,
// use one playback input for both layouts, including presets from older packages.
export async function ensureDesktopAudio(call, preset, remember) {
  let saved = preset.desktopAudio;
  // Only an interrupted addition needs placement on retry. Existing outputs may
  // have been unlocked or moved in OBS, including the same input in another scene.
  const pending = preset.pendingDesktopItem;
  if (pending) {
    const target = sceneTarget(pending.layout, preset.sceneIds);
    if ((target.sceneUuid || null) === pending.sceneUuid) {
      const { sceneItems } = await call('GetSceneItemList', target);
      const item = sceneItems.find(i => i.inputKind === desktopKind && i.sourceName === pending.name &&
        (!pending.uuid || i.sourceUuid === pending.uuid));
      if (item) {
        await placeDesktopItem(call, target, item.sceneItemId);
        if (pending.newInput) saved = { name: item.sourceName, uuid: item.sourceUuid || null };
      }
    }
    await remember({ desktopAudio: saved, pendingDesktopItem: null });
  }
  const { desktop1, desktop2 } = await call('GetSpecialInputs');
  const globalDesktop = desktop1 || desktop2;
  if (globalDesktop && !saved) return;

  const { inputs } = await call('GetInputList');
  const owned = saved && inputs.find(input => input.inputKind === desktopKind &&
    (saved.uuid ? input.inputUuid === saved.uuid : input.inputName === saved.name));
  if (globalDesktop && !owned) return;
  const scenes = [];
  for (const layout of layouts) {
    const target = sceneTarget(layout, preset.sceneIds);
    const { sceneItems } = await call('GetSceneItemList', target);
    scenes.push({ layout, target, outputs: sceneItems.filter(item => item.inputKind === desktopKind) });
  }
  const existing = scenes.flatMap(scene => scene.outputs).find(item => item.sceneItemEnabled);
  let shared = owned || inputs.find(input => input.inputName === existing?.sourceName);
  for (const { layout, target, outputs } of scenes) {
    const ownItem = outputs.find(item => item.sourceName === owned?.inputName);
    const hasOtherOutput = outputs.some(item => item !== ownItem && item.sceneItemEnabled);
    const needsOutput = !globalDesktop && !hasOtherOutput;
    if (ownItem) {
      if (ownItem.sceneItemEnabled !== needsOutput) {
        await call('SetSceneItemEnabled', { ...target, sceneItemId: ownItem.sceneItemId, sceneItemEnabled: needsOutput });
      }
      continue;
    }
    if (!needsOutput) continue;

    const existingItem = shared && outputs.find(output => output.sourceName === shared.inputName);
    if (existingItem) {
      await call('SetSceneItemEnabled', { ...target, sceneItemId: existingItem.sceneItemId, sceneItemEnabled: true });
      continue;
    }
    const name = shared?.inputName ?? await availableDesktopName(call, inputs);
    await remember({ pendingDesktopItem: {
      layout, sceneUuid: target.sceneUuid || null, name, uuid: shared?.inputUuid || null, newInput: !shared,
    } });
    let added;
    if (shared) {
      const source = shared.inputUuid ? { sourceUuid: shared.inputUuid } : { sourceName: shared.inputName };
      added = await call('CreateSceneItem', { ...target, ...source, sceneItemEnabled: true });
    } else {
      added = await call('CreateInput', { ...target, inputName: name, inputKind: desktopKind, inputSettings: { device_id: 'default' }, sceneItemEnabled: true });
      shared = { inputName: name, inputUuid: added.inputUuid };
      saved = { name, uuid: added.inputUuid || null };
    }
    await placeDesktopItem(call, target, added.sceneItemId);
    await remember({ desktopAudio: saved, pendingDesktopItem: null });
  }
}

// Only owned scene items are adjusted. Normal follow/reconnect and a repeated
// create skip this entirely once the saved geometry matches the session.
export async function arrangeCaptures(call, preset, source, layouts = ['regular', 'ex']) {
  for (const layout of layouts) {
    const target = sceneTarget(layout, preset.sceneIds);
    const { sceneItems } = await call('GetSceneItemList', target);
    const ex = layout === 'ex';
    const positions = ex ? exPositions : slots;
    const lineup = ex ? preset.lineup : slots;
    const items = slots.map(slot => ({ slot, ...target, sceneItemId: itemId(sceneItems, capture(slot)) }));
    for (const { slot, ...item } of items) {
      if (!lineup.includes(slot)) await call('SetSceneItemEnabled', { ...item, sceneItemEnabled: false });
    }
    for (const [index, slot] of lineup.entries()) {
      const { sceneItemId } = items.find(item => item.slot === slot);
      const item = { ...target, sceneItemId };
      await call('SetSceneItemTransform', { ...item, sceneItemTransform: captureTransform(positions[index], source, ex) });
      await call('SetSceneItemEnabled', { ...item, sceneItemEnabled: true });
    }
  }
}

function windowOptions(items) {
  const choices = [];
  const titles = new Map();
  for (const item of items) {
    if (!item.itemEnabled || typeof item.itemValue !== 'string') continue;
    const [encodedTitle, windowClass, exe] = item.itemValue.split(':');
    if (!windowClass || !exe) continue;
    const title = encodedTitle.replaceAll('#3A', ':').replaceAll('#22', '#');
    const key = title.toLowerCase();
    titles.set(key, (titles.get(key) || 0) + 1);
    if (exe.toLowerCase() !== 'osu!.exe') continue;
    // osu!tourney can pad its titles. OBS still needs the original identifier for title matching.
    const match = /^(?:osu!\s*[-–]?\s*)?(?:tournament|tourney)\s+client\s*#?\s*(\d+)$/i.exec(title.trim());
    choices.push({ value: item.itemValue, label: title, index: match ? Number(match[1]) : null });
  }
  // OBS's "Window title must match" compares only the case-insensitive title,
  // even when the property values contain different classes or executables.
  return { choices, windows: choices.filter(w => titles.get(w.label.toLowerCase()) === 1) };
}

export async function inspectWindows(call, preset, { edit, useDesktopAudio = false } = {}) {
  const { propertyItems } = await call('GetInputPropertiesListPropertyItems', { inputName: capture('A1'), propertyName: 'window' });
  const { choices, windows } = windowOptions(propertyItems);
  const bindings = {};
  for (const slot of slots) {
    const { inputSettings, inputKind } = await call('GetInputSettings', { inputName: capture(slot) });
    if (useDesktopAudio && inputKind === preset.kind && inputSettings.capture_audio) {
      await call('SetInputSettings', { inputName: capture(slot), inputSettings: { capture_audio: false }, overlay: true });
    }
    bindings[slot] = inputSettings.window || '';
  }
  const assign = async (slot, value) => {
    await call('SetInputSettings', { inputName: capture(slot), inputSettings: { window: value, priority: 1 }, overlay: true });
    bindings[slot] = value;
  };
  if (edit) {
    if (!slots.includes(edit.slot) || typeof edit.value !== 'string' || (edit.value && !windows.some(w => w.value === edit.value))) {
      throw new ObsError('窗口列表已变化，请重新识别窗口并选择。');
    }
    if (edit.value && slots.some(other => other !== edit.slot && bindings[other] === edit.value)) throw new ObsError('这个窗口已绑定到其他槽位，请先将原槽位留空。');
    await assign(edit.slot, edit.value);
  }
  const rows = [];
  for (const [index, slot] of slots.entries()) {
    const candidates = choices.filter(w => w.index === index);
    const manualEmpty = preset.manualEmpty.includes(slot);
    if (!bindings[slot] && !manualEmpty && candidates.length === 1 && windows.includes(candidates[0]) && !Object.values(bindings).includes(candidates[0].value)) {
      await assign(slot, candidates[0].value);
    }
    const value = bindings[slot];
    const present = !!value && windows.some(w => w.value === value);
    const duplicate = !!value && slots.some(other => other !== slot && bindings[other] === value);
    const ambiguous = value ? choices.some(w => w.value === value) && !present : candidates.length > 1 || (candidates.length === 1 && !windows.includes(candidates[0]));
    const status = duplicate ? '多个槽位使用同一窗口，请补选' : present ? '已绑定' : manualEmpty ? '手动留空'
      : ambiguous ? '窗口有歧义，请补选或关闭重名窗口' : value ? '原窗口未识别，请核对' : '未找到窗口，请补选';
    rows.push({ slot, input: capture(slot), value, status });
  }
  return { windows, rows };
}

export async function measureScenes(call, profile, managed) {
  const rows = [];
  const windows = new Map();
  for (const layout of ['regular', 'ex']) {
    const sceneName = profile[layout];
    const { sceneItems } = await call('GetSceneItemList', { sceneName });
    for (const item of sceneItems) {
      if (item.inputKind === desktopKind) continue;
      const { sceneItemTransform: t } = await call('GetSceneItemTransform', { sceneName, sceneItemId: item.sceneItemId });
      const slot = managed && slots.find(s => capture(s) === item.sourceName);
      if (slot && !windows.has(slot)) {
        const { inputSettings } = await call('GetInputSettings', { inputName: item.sourceName });
        windows.set(slot, inputSettings.window || null);
      }
      rows.push({ scene: sceneName, input: item.sourceName, visible: item.sceneItemEnabled,
        ...(slot ? { position: layout === 'regular' ? slot : exPositions[profile.preset.lineup.indexOf(slot)] ?? null, window: windows.get(slot) } : {}),
        sourceWidth: t.sourceWidth, sourceHeight: t.sourceHeight, x: t.positionX, y: t.positionY, alignment: t.alignment,
        scaleX: t.scaleX, scaleY: t.scaleY, boundsType: t.boundsType, boundsWidth: t.boundsWidth, boundsHeight: t.boundsHeight,
        cropLeft: t.cropLeft, cropTop: t.cropTop, cropRight: t.cropRight, cropBottom: t.cropBottom });
    }
  }
  return rows;
}
