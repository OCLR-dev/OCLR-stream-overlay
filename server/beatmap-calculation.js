import { Worker } from 'node:worker_threads';

export const TEST_MODS = ['NM', 'HD', 'HR', 'DT'];
export const testModForCategory = mod => TEST_MODS.includes(mod) ? mod : 'NM';
let queue = Promise.resolve();

// Keep WASM work off the score/SSE thread and allow only one calculation at a
// time. A pathological map cannot leave the broadcast process blocked.
export function calculateBeatmap(body, mod) {
  if (!TEST_MODS.includes(mod)) return Promise.reject(new Error('INVALID_CALCULATION_MOD'));
  const task = queue.then(() => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./beatmap-calculation-worker.js', import.meta.url), {
      workerData: { body, mod }, resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('CALCULATION_TIMEOUT')), 5000);
    worker.once('message', value => finish(value.error ? new Error(value.error) : null, value.calculation));
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!settled) finish(new Error('CALCULATION_EXITED')); });
  }));
  queue = task.catch(() => {});
  return task;
}
