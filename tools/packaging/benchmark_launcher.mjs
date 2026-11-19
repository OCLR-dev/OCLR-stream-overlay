import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {availableLoopbackPort,fixtureDataDir} from './portable-fixture.mjs';
const dir=resolve('.local/launcher-benchmark');
const runDir=join(dir,'run-'+Date.now());
const prepared=JSON.parse(await readFile(join(dir,'prepared.json'),'utf8'));
const profiles={},logs={},port=await availableLoopbackPort(0),endpoint=`http://127.0.0.1:${port}`;
const build=JSON.parse(await readFile('release/OCLR-Windows-x64/app/portable-build.json','utf8')).build;
if(prepared.build!==build)throw Error('Package changed; prepare the benchmark again');
for(const variant of ['win32','windigo','wails']){
 profiles[variant]=await fixtureDataDir(runDir,`profile-${variant}`,'OCLR/StreamOverlay');
 const prefs=join(profiles[variant],'OCLR/StreamOverlayLauncher');await mkdir(prefs,{recursive:true});
 await writeFile(join(prefs,'service-port.txt'),String(port));logs[variant]=join(prefs,'launcher.log');
}
const health=()=>fetch(endpoint+'/api/health',{signal:AbortSignal.timeout(250)}).then(r=>r.json()).catch(()=>null);
const live=new Set();
async function measure(variant){
 const stopFile=join(profiles[variant],'benchmark-stop');
 await rm(stopFile,{force:true});
 await writeFile(logs[variant],'');
 const started=Date.now(),clock=performance.now();
 const child=spawn(join(dir,variant,'OCLR.exe'),[],{cwd:dir,env:{...process.env,LOCALAPPDATA:profiles[variant],OCLR_BENCH_STOP:stopFile},stdio:['pipe','ignore','pipe']});live.add(child);
 const done=new Promise(resolve=>child.once('close',resolve));let stderr='';child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});
 let healthMs,frameMs,readyMs;
 try{
  while(performance.now()-clock<20_000){
   if(child.exitCode!==null||child.signalCode!==null)throw Error(`${variant} exited: ${stderr}`);
   if(healthMs===undefined){const h=await health();if(h?.ready&&h.build===build)healthMs=Math.round(performance.now()-clock);}
   const log=await readFile(logs[variant],'utf8').catch(()=>'');
   const mark=stage=>{const line=log.split(/\r?\n/).find(l=>l.endsWith('benchmark_'+stage));return line?Date.parse(line.split(' ')[0])-started:undefined;};
   frameMs??=mark('frame');readyMs??=mark('ready');
   if(healthMs!==undefined&&frameMs!==undefined&&readyMs!==undefined)break;
   await delay(15);
  }
  if([healthMs,frameMs,readyMs].some(x=>x===undefined))throw Error(`${variant} incomplete markers: ${JSON.stringify({healthMs,frameMs,readyMs})}`);
  return{healthMs,frameMs,readyMs};
 }finally{
  // The test-only hook acknowledges the normal close flow and waits for saving.
  await writeFile(stopFile,'stop');
  const closed=await Promise.race([done.then(()=>true),delay(10_000,undefined,{ref:false}).then(()=>false)]);
  if(!closed){child.kill();await done;throw Error('normal benchmark shutdown timed out');}
  live.delete(child);
  const end=Date.now()+10_000;while(await health()){if(Date.now()>end)throw Error('owned backend did not stop after normal shutdown');await delay(25);}
  await delay(250);
 }
}
const report={date:new Date().toISOString(),baselines:{win32:'d6f9df4',windigo:'0014963'},build,method:'same Node/service/assets; full GUI; browser auto-open suppressed; temporary readiness instrumentation; normal graceful shutdown; 7 alternating warm samples after one first-profile launch per variant',firstProfile:{},samples:{win32:[],windigo:[],wails:[]}};
try{
 for(const v of ['win32','windigo','wails']){report.firstProfile[v]=await measure(v);console.log('first profile',v,report.firstProfile[v]);}
 for(let i=0;i<7;i++)for(const v of i%2===0?['win32','windigo','wails']:['wails','windigo','win32']){const sample=await measure(v);report.samples[v].push(sample);console.log(i+1,v,sample);}
 report.summary=Object.fromEntries(Object.entries(report.samples).map(([v,samples])=>[v,Object.fromEntries(['healthMs','frameMs','readyMs'].map(metric=>{const sorted=samples.map(x=>x[metric]).sort((a,b)=>a-b);return[metric,{min:sorted[0],median:sorted[3],max:sorted[6]}]}))]));
 report.sizes={win32ExeBytes:(await stat(join(dir,'win32-original.exe'))).size,windigoExeBytes:(await stat(join(dir,'windigo-original.exe'))).size,wailsExeBytes:(await stat('release/OCLR-Windows-x64/OCLR.exe')).size,wailsZipBytes:(await stat('release/OCLR-Windows-x64.zip')).size};
 report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;}
finally{for(const c of live)c.kill();await writeFile(join(dir,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
