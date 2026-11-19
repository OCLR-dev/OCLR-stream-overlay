const outputState = data => data.outputState?.replace('OBS_WEBSOCKET_OUTPUT_', '');

export class ObsOutputs {
  constructor() { this.reset(); }

  reset() {
    this.stream = null;
    this.record = null;
    this.group = null;
    this.streamRevision = 0;
    this.recordRevision = 0;
  }

  async initialize(socket, current) {
    const reconnected = this.connectedOnce;
    this.connectedOnce = true;
    const streamRevision = this.streamRevision;
    const recordRevision = this.recordRevision;
    await Promise.allSettled([
      socket.request('GetStreamStatus', {}, { resetOnTimeout: false }).then(status => {
        if (current() && streamRevision === this.streamRevision) {
          this.stream = status.outputReconnecting ? 'reconnecting' : status.outputActive ? 'active' : 'off';
        }
      }),
      socket.request('GetRecordStatus', {}, { resetOnTimeout: false }).then(status => {
        if (current() && recordRevision === this.recordRevision) {
          this.setRecord(status.outputPaused ? 'paused' : status.outputActive ? 'active' : 'off', true, reconnected);
        }
      }),
    ]);
  }

  setRecord(state, attached = false, reconnected = false) {
    if (state === this.record) return;
    this.recordRevision++;
    this.record = state;
    if (state === 'active' || state === 'paused') {
      this.group ??= { id: crypto.randomUUID(), attached, reconnected };
    } else {
      this.group = null;
    }
  }

  event(type, data) {
    const state = outputState(data);
    if (type === 'StreamStateChanged') {
      this.streamRevision++;
      this.stream = state === 'RECONNECTING' ? 'reconnecting' : state === 'STARTING' ? 'starting'
        : state === 'STOPPING' ? 'stopping' : data.outputActive ? 'active' : 'off';
    } else if (type === 'RecordStateChanged') {
      const next = { STARTING: 'starting', STARTED: 'active', PAUSED: 'paused', RESUMED: 'active',
        STOPPING: 'stopping', STOPPED: 'off' }[state];
      if (next) this.setRecord(next);
    }
  }

  async timestamp(socket, current) {
    if (!socket || this.record !== 'active') return null;
    const group = this.group;
    const revision = this.recordRevision;
    const status = await socket.request('GetRecordStatus', {}, { resetOnTimeout: false });
    if (!current() || group !== this.group || revision !== this.recordRevision || !status.outputActive || status.outputPaused ||
        !Number.isSafeInteger(status.outputDuration) || status.outputDuration < 0) return null;
    return { group, duration: status.outputDuration };
  }
}
