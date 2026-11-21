import { ensureDesktopAudio, presetScenes, windowOptions } from './presets.js';

const kind = 'wasapi_process_output_capture';
const name = 'OCLR · osu!tourney 音频';
const layouts = Object.keys(presetScenes);
const titlePriority = 1;
// With an empty selection, title matching could capture an untitled window.
// Executable matching with an empty executable cannot select a process.
const unboundPriority = 2;
const targetOf = (preset, layout) => preset.sceneIds[layout]
  ? { sceneUuid: preset.sceneIds[layout] } : { sceneName: presetScenes[layout] };
const sourceOf = input => input.inputUuid ? { sourceUuid: input.inputUuid } : { sourceName: input.inputName };
const matches = (saved, input) => saved && (saved.uuid ? input.inputUuid === saved.uuid : input.inputName === saved.name);

async function place(call, target, sceneItemId) {
  await call('SetSceneItemIndex', { ...target, sceneItemId, sceneItemIndex: 0 });
  await call('SetSceneItemLocked', { ...target, sceneItemId, sceneItemLocked: true });
}

// One process-loopback input survives EX lineup changes, even when Client 0's
// video is hidden. Never match another osu!.exe process by executable alone.
export async function ensureTournamentAudio(call, preset, remember, { desktop = false } = {}) {
  const { inputKinds } = await call('GetInputKindList');
  if (!inputKinds.includes(kind)) {
    if (desktop) await ensureDesktopAudio(call, preset, remember);
    return inputKinds.includes('wasapi_output_capture') ? { mode: 'desktop', bound: false, window: null,
      status: '当前 OBS 未提供应用程序音频采集，暂用桌面音频；请升级 OBS 后重试', globalDesktop: false } : null;
  }
  let saved = preset.applicationAudio;
  const pending = preset.pendingApplicationItem;
  if (pending) {
    const target = targetOf(preset, pending.layout);
    if ((target.sceneUuid || null) === pending.sceneUuid) {
      const { sceneItems } = await call('GetSceneItemList', target);
      const item = sceneItems.find(i => i.inputKind === kind && i.sourceName === pending.name &&
        (!pending.uuid || i.sourceUuid === pending.uuid));
      if (item) {
        await place(call, target, item.sceneItemId);
        saved = { name: item.sourceName, uuid: item.sourceUuid || null };
      }
    }
    await remember({ applicationAudio: saved, pendingApplicationItem: null });
  }
  const { inputs } = await call('GetInputList');
  let shared = inputs.find(input => input.inputKind === kind && matches(saved, input));
  const scenes = [];
  for (const layout of layouts) {
    const target = targetOf(preset, layout);
    const { sceneItems } = await call('GetSceneItemList', target);
    scenes.push({ layout, target, items: sceneItems });
  }
  for (const scene of scenes) {
    let item = shared && scene.items.find(item => item.sourceName === shared.inputName);
    if (!item) {
      let inputName = shared?.inputName;
      if (!shared) {
        const { scenes: allScenes } = await call('GetSceneList');
        const { groups } = await call('GetGroupList');
        const occupied = new Set([...inputs.map(input => input.inputName), ...allScenes.map(s => s.sceneName), ...groups]);
        inputName = name;
        for (let n = 2; occupied.has(inputName); n++) inputName = `${name} (${n})`;
      }
      await remember({ pendingApplicationItem: { layout: scene.layout, sceneUuid: scene.target.sceneUuid || null,
        name: inputName, uuid: shared?.inputUuid || null } });
      let added;
      if (shared) added = await call('CreateSceneItem', { ...scene.target, ...sourceOf(shared), sceneItemEnabled: false });
      else {
        added = await call('CreateInput', { ...scene.target, inputName, inputKind: kind,
          inputSettings: { window: '', priority: unboundPriority }, sceneItemEnabled: false });
        shared = { inputName, inputUuid: added.inputUuid };
        saved = { name: inputName, uuid: added.inputUuid || null };
      }
      await place(call, scene.target, added.sceneItemId);
      await remember({ applicationAudio: saved, pendingApplicationItem: null });
      item = { sceneItemId: added.sceneItemId, sceneItemEnabled: false };
    }
    scene.item = item;
  }

  const { propertyItems } = await call('GetInputPropertiesListPropertyItems', { inputName: shared.inputName, propertyName: 'window' });
  const { choices, windows } = windowOptions(propertyItems);
  const clients = choices.filter(window => window.index === 0);
  const selected = clients.length === 1 && windows.includes(clients[0]) ? clients[0] : null;
  const { inputSettings } = await call('GetInputSettings', { inputName: shared.inputName });
  const window = selected?.value || '';
  const priority = selected ? titlePriority : unboundPriority;
  if (inputSettings.window !== window || inputSettings.priority !== priority) {
    await call('SetInputSettings', { inputName: shared.inputName, inputSettings: { window, priority }, overlay: true });
  }
  for (const scene of scenes) {
    if (!scene.item.sceneItemEnabled) {
      await call('SetSceneItemEnabled', { ...scene.target, sceneItemId: scene.item.sceneItemId, sceneItemEnabled: true });
    }
    // Migrate only our own old desktop items. The operator's global mixer and
    // sources in unrelated scenes are outside the preset's ownership.
    const legacy = inputs.find(input => input.inputKind === 'wasapi_output_capture' && matches(preset.desktopAudio, input));
    for (const item of scene.items) {
      if (legacy?.inputName === item.sourceName && item.sceneItemEnabled) {
        await call('SetSceneItemEnabled', { ...scene.target, sceneItemId: item.sceneItemId, sceneItemEnabled: false });
      }
    }
  }
  const { desktop1, desktop2 } = await call('GetSpecialInputs');
  return { mode: 'application', input: shared.inputName, window: selected?.label || null, bound: !!selected,
    status: selected ? '已绑定 osu!tourney Client 0' : clients.length ? 'Client 0 窗口重名，等待唯一窗口' : '等待 osu!tourney Client 0',
    globalDesktop: !!(desktop1 || desktop2) };
}
