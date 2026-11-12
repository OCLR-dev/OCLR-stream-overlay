import assert from 'node:assert/strict';
import { ObsError } from '../server/obs/socket.js';

export const clientWindow = (index, windowClass = 'WindowsForms10.Window') => ({
  itemName: `[osu!.exe]: Tournament Client ${index}`, itemValue: `Tournament Client ${index}:${windowClass}:osu!.exe`, itemEnabled: true,
});

// Stateful fixture: Program and Preview are independent, inputs are shared, and
// each collection owns a distinct scene/item namespace, as in Studio Mode.
export class Studio {
  constructor() {
    this.log = [];
    this.scenes = new Map([['休息', []]]);
    this.sceneIds = new Map();
    this.inputs = new Map();
    this.program = '休息';
    this.preview = '预览';
    this.collection = '比赛集合';
    this.windows = Array.from({ length: 8 }, (_, i) => clientWindow(i));
    this.canvas = { baseWidth: 1920, baseHeight: 1080 };
    this.kinds = ['browser_source', 'game_capture', 'wasapi_output_capture'];
    this.specialInputs = { desktop1: null, desktop2: null, mic1: null };
    this.counter = 0;
    this.connections = 0;
    const studio = this;
    this.Socket = class {
      constructor(options) {
        this.ready = Promise.resolve();
        this.options = options;
        studio.connections++;
        studio.socket = this;
      }
      request(type, args = {}) { return studio.request(type, args); }
      close() {
        if (this.closed) return;
        this.closed = true;
        this.options.onClose('OBS 连接中断');
      }
    };
  }

  event(type, data) { if (!this.socket?.closed) this.socket?.options.onEvent(type, data); }
  cut(sceneName) {
    this.program = sceneName;
    this.event('CurrentProgramSceneChanged', { sceneName });
  }
  addItem(scene, name, enabled) {
    const input = this.inputs.get(name);
    const item = { sourceName: name, sourceUuid: input?.inputUuid, inputKind: input?.inputKind, sceneItemId: ++this.counter, sceneItemEnabled: enabled, transform: {} };
    this.scenes.get(scene).push(item);
    return { sceneItemId: item.sceneItemId };
  }
  async removeScene(name, notify = true) {
    this.scenes.delete(name);
    this.sceneIds.delete(name);
    const referenced = new Set([...Object.values(this.specialInputs), ...[...this.scenes.values()].flat().map(item => item.sourceName)]);
    for (const input of this.inputs.keys()) if (!referenced.has(input)) this.inputs.delete(input);
    if (this.program === name) this.cut(this.scenes.keys().next().value);
    if (notify) this.event('SceneListChanged', await this.request('GetSceneList'));
  }
  async request(type, args = {}) {
    this.log.push({ type, ...structuredClone(args) });
    await this.before?.(type, args);
    if (type === this.failNext) { this.failNext = null; throw new ObsError('模拟请求失败'); }
    if (args.sceneUuid) {
      const sceneName = [...this.sceneIds].find(([, uuid]) => uuid === args.sceneUuid)?.[0];
      assert.ok(sceneName);
      args = { ...args, sceneName };
    }
    if (args.sourceUuid) {
      const input = [...this.inputs.values()].find(source => source.inputUuid === args.sourceUuid);
      assert.ok(input);
      args = { ...args, sourceName: input.inputName };
    }
    const sceneItems = this.scenes.get(args.sceneName) || [];
    const item = sceneItems.find(i => i.sceneItemId === args.sceneItemId);
    switch (type) {
      case 'GetSceneCollectionList': return { currentSceneCollectionName: this.collection };
      case 'GetSceneList': return { scenes: [...this.scenes.keys()].map(sceneName => ({ sceneName, sceneUuid: this.sceneIds.get(sceneName) })), currentPreviewSceneName: this.preview };
      case 'GetCurrentProgramScene': return { currentProgramSceneName: this.program };
      case 'SetCurrentProgramScene': {
        const name = args.sceneName ?? [...this.sceneIds].find(([, uuid]) => uuid === args.sceneUuid)?.[0];
        assert.ok(this.scenes.has(name)); this.cut(name); break;
      }
      case 'GetVideoSettings': return this.canvas;
      case 'GetInputKindList': return { inputKinds: this.kinds };
      case 'GetSpecialInputs': return this.specialInputs;
      case 'GetInputList': return { inputs: [...this.inputs.values()] };
      case 'GetGroupList': return { groups: [] };
      case 'CreateScene':
        assert.ok(!this.scenes.has(args.sceneName)); this.scenes.set(args.sceneName, []);
        if (this.useUuids) this.sceneIds.set(args.sceneName, crypto.randomUUID());
        return { sceneUuid: this.sceneIds.get(args.sceneName) };
      case 'GetSceneItemList': assert.ok(this.scenes.has(args.sceneName)); return { sceneItems: structuredClone(sceneItems) };
      case 'CreateInput': {
        assert.ok(!this.inputs.has(args.inputName));
        const inputUuid = this.useUuids ? crypto.randomUUID() : undefined;
        this.inputs.set(args.inputName, { inputName: args.inputName, inputUuid, inputKind: args.inputKind, inputSettings: { ...args.inputSettings } });
        return { inputUuid, ...this.addItem(args.sceneName, args.inputName, args.sceneItemEnabled) };
      }
      case 'CreateSceneItem':
        assert.ok(this.inputs.has(args.sourceName)); return this.addItem(args.sceneName, args.sourceName, args.sceneItemEnabled);
      case 'SetSceneItemTransform': Object.assign(item.transform, args.sceneItemTransform); break;
      case 'SetSceneItemEnabled': item.sceneItemEnabled = args.sceneItemEnabled; break;
      case 'SetSceneItemIndex':
        sceneItems.splice(sceneItems.indexOf(item), 1); sceneItems.splice(args.sceneItemIndex, 0, item); break;
      case 'GetSceneItemTransform': return { sceneItemTransform: { sourceWidth: 320, sourceHeight: 240, ...item.transform } };
      case 'GetInputPropertiesListPropertyItems': return { propertyItems: this.windows };
      case 'GetInputSettings': return structuredClone(this.inputs.get(args.inputName));
      case 'SetInputSettings': Object.assign(this.inputs.get(args.inputName).inputSettings, args.inputSettings); break;
      default: assert.fail('Unexpected OBS request ' + type);
    }
    return {};
  }
}
