// Windows only. Build the portable package first. All modifications stay in .local.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

assert.equal(process.platform, 'win32');
const root = process.cwd();
const dir = join(root, '.local/launcher-benchmark');
await mkdir(dir, { recursive: true });
const build = JSON.parse(await readFile('release/OCLR-Windows-x64/app/portable-build.json', 'utf8')).build;
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const replace = (text, pattern, value) => {
  assert.ok(typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text), `Instrumentation anchor missing: ${pattern}`);
  const result = text.replace(pattern, value);
  assert.notEqual(text, result);
  return result;
};
const variants = { win32: 'd6f9df4', windigo: '0014963' };
for (const [name, ref] of Object.entries(variants)) {
  // git show supplies pristine tracked files on every run, avoiding double markers.
  const source = join(dir, `${name}-source/tools/windows-launcher`);
  await mkdir(source, { recursive: true });
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'tools/windows-launcher'], { encoding: 'utf8' }).trim().split('\n');
  for (const path of files) {
    const target = join(dir, `${name}-source`, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, execFileSync('git', ['show', `${ref}:${path}`]));
  }
  await cp('release/OCLR-Windows-x64', join(dir, name), { recursive: true });
  const flags = `-H=windowsgui -s -w -X main.buildID=${build}`;
  run('go', ['build', '-mod=readonly', '-trimpath', '-ldflags', flags, '-o', join(dir, `${name}-original.exe`), '.'], source);
  const main = join(source, 'main_windows.go');
  let text = await readFile(main, 'utf8');
  text = replace(text, /func open\(s string\) \{[\s\S]*?\r?\n\}\r?\n/, 'func open(s string) {}\n');
  assert.ok(text.includes('func open(s string) {}'), 'Auto browser opening must be disabled');
  text = replace(text, 'func showServiceReady() {', 'func showServiceReady() {\n defer func(){call(user,"UpdateWindow",window);localLog.record("benchmark_ready");go benchmarkStop()}()');
  text = replace(text, /call\(user, "MessageBoxW", (h|window), ptr\("退出会停止 OBS[\s\S]*?0x124\) == 6/, 'true /* synthetic benchmark confirms normal shutdown */');
  text = replace(text, 'Local\\\\OCLR.StreamOverlay.Portable', 'Local\\\\OCLR.StreamOverlay.Benchmark');
  await writeFile(main, text);
  const ui = join(source, 'ui_windows.go');
  text = await readFile(ui, 'utf8');
  if (name === 'win32') {
    text = replace(text, 'call(user, "UpdateWindow", window)', 'call(user, "UpdateWindow", window)\n localLog.record("benchmark_frame")');
  } else {
    text = replace(text, 'wnd.On().WmEraseBkgnd(func(p ui.WmEraseBkgnd) int {', 'markedFrame := false\n wnd.On().WmEraseBkgnd(func(p ui.WmEraseBkgnd) int {\n defer func(){if !markedFrame {markedFrame=true;localLog.record("benchmark_frame")}}()');
  }
  await writeFile(ui, text);
  await writeFile(join(source, 'benchmark_windows.go'), 'package main\nimport("os";"time")\nfunc benchmarkStop(){for{if _,err:=os.Stat(os.Getenv("OCLR_BENCH_STOP"));err==nil{call(user,"PostMessageW",window,0x10,0,0);return};time.Sleep(20*time.Millisecond)}}\n');
  run('go', ['build', '-mod=readonly', '-trimpath', '-ldflags', flags, '-o', join(dir, name, 'OCLR.exe'), '.'], source);
}
const source = join(dir, 'wails-source');
await cp('tools/windows-launcher', source, { recursive: true });
await cp('release/OCLR-Windows-x64', join(dir, 'wails'), { recursive: true });
const vue = join(source, 'frontend/src/App.vue');
let text = await readFile(vue, 'utf8');
text = replace(text, 'computed, onMounted, onUnmounted, ref', 'computed, onMounted, onUnmounted, ref, watch, nextTick');
text = replace(text, 'onMounted(poll);', `let markedReady=false;
async function mark(stage:string){await nextTick();requestAnimationFrame(()=>requestAnimationFrame(()=>launcher().BenchmarkMark(stage)));}
watch(()=>state.value.status,status=>{if(status==='ready'&&!markedReady){markedReady=true;void mark('ready');}});
onMounted(()=>{void mark('frame');void poll();});`);
await writeFile(vue, text);
const bridge = join(source, 'frontend/src/bridge.ts');
await writeFile(bridge, replace(await readFile(bridge, 'utf8'), 'interface Launcher {', 'interface Launcher {\n BenchmarkMark(stage:string):Promise<void>;'));
await writeFile(join(source, 'benchmark_windows.go'), 'package main\nimport("os";"time";wruntime "github.com/wailsapp/wails/v2/pkg/runtime")\nfunc(a *Launcher) BenchmarkMark(stage string){if stage=="frame"||stage=="ready"{a.log.record("benchmark_%s",stage)};if stage=="ready"{go func(){for{if _,err:=os.Stat(os.Getenv("OCLR_BENCH_STOP"));err==nil{a.op.Lock();if a.service!=nil{a.service.stop("benchmark")};a.quitAllowed=true;a.op.Unlock();wruntime.Quit(a.ctx);return};time.Sleep(20*time.Millisecond)}}()}}\n');
run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', join(source, 'frontend/vite.config.ts')]);
run('go', ['build', '-mod=readonly', '-tags', 'desktop,production', '-trimpath', '-ldflags', `-H=windowsgui -s -w -X main.buildID=${build} -X main.instanceMutex=Local\\OCLR.StreamOverlay.Benchmark -X main.autoOpenControl=false`, '-o', join(dir, 'wails/OCLR.exe'), '.'], source);
await writeFile(join(dir, 'prepared.json'), JSON.stringify({ build, variants, wailsSource: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), workingTreeMayDiffer: true }, null, 2));
console.log('Prepared isolated full-window launchers:', build);
