import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newSession, transition, currentRound } from '../server/session/model.js';
import { SessionStore } from '../server/session/store.js';
const pool=Array.from({length:16},(_,i)=>({id:`m${i}`,mod:'NM',label:`NM${i+1}`,beatmapId:810000+i}));
const cmd=(s,type,payload={})=>transition(s,{id:randomUUID(),version:s.version,type,payload});
function setup(){let s=cmd(newSession(),'setup',{title:'隔离动作优先回归',stage:'group',mode:'4v4',source:'4x3',teams:{a:{name:'Red',roster:[]},b:{name:'Blue',roster:[]}},pool});return cmd(s,'set-roll',{winner:null,banFirst:'a',pickFirst:'b'});}
const choose=(s,team,kind)=>cmd(s,'select-bp-action',{team,kind});
const apply=(s,id)=>cmd(s,'apply-bp',{entryId:id,actionId:s.action.id});

test('choosing an action before a map arms the server without changing marks, results, independent Roll or future flow',()=>{
 let s=setup();const before=structuredClone(s);s=choose(s,'a','ban');
 assert.equal(s.action.team,'a');assert.equal(s.action.kind,'ban');assert.equal(s.action.slot,0);
 for(const key of ['poolMarks','bpHistory','bans','rounds','queue','roll','bpFlow','auto'])assert.deepEqual(s[key],before[key],key);
 s=cmd(s,'undo');assert.deepEqual(s.action,before.action);
});
test('the next unused Ban slot is selected automatically; full slots still allow marks without adding Bans',()=>{
 let s=apply(choose(setup(),'a','ban'),'m0');s=apply(choose(s,'a','ban'),'m1');assert.equal(s.bans.a[1],'m1');
 const bans=structuredClone(s.bans);const history=structuredClone(s.bpHistory);
 s=cmd(choose(s,'a','ban'),'choose-pool-map',{entryId:'m2'});
 assert.deepEqual(s.bans,bans);assert.deepEqual(s.bpHistory,history);assert.equal(s.poolMarks.at(-1).entryId,'m2');
});
test('free modes and broadcast corrections preserve prepared/playing maps, incidents, pause and a completed series',()=>{
 const protectedChoice=state=>{
  const next=choose(state,'b','ban');
  for(const key of ['rounds','action','queue','bans','phase','incident','paused','seriesAdjustment'])assert.deepEqual(next[key],state[key],key);
  return next;
 };
 let s=apply(choose(setup(),'a','pick'),'m0');s=protectedChoice(s);
 s=cmd(s,'start');const run=currentRound(s).runId;
 for(const state of [s,cmd(s,'pause',{kind:'technical'}),cmd(s,'incident',{kind:'abort',reason:'核对本局'})]){
  const next=cmd(protectedChoice(state),'choose-pool-map',{entryId:'m2'});
  assert.deepEqual(next.rounds,state.rounds);assert.equal(currentRound(next).runId,run);assert.deepEqual(next.bans,state.bans);
 }
 s=cmd(s,'ranking');s=cmd(s,'set-series',{a:6,b:0,reason:'核对系列已结束'});
 const next=cmd(protectedChoice(s),'choose-pool-map',{entryId:'m2'});assert.deepEqual(next.rounds,s.rounds);assert.deepEqual(next.seriesAdjustment,s.seriesAdjustment);
});
test('an old pending map never transfers to a newly armed action; the next fresh map is consumed once',async()=>{
 const store=new SessionStore({state:setup()});let now=0;
 const send=(type,payload)=>store.command({id:randomUUID(),version:store.state.version,type,payload});
 const frame=map=>store.frame({beatmap:{id:map},tourney:{ipcState:1,teams:{left:'L',right:'R'},players:[{side:'left',osuId:1},{side:'right',osuId:2}],totalScore:{left:0,right:0}}},now+=500);
 await send('auto',{...store.state.auto,profile:'stable-tourney',left:'L',right:'R'});await frame(899999);await frame(810000);
 await send('select-bp-action',{team:'b',kind:'ban'});await frame(810000);assert.equal(store.state.bpHistory.length,0);
 await frame(810001);await frame(810001);assert.equal(store.state.bans.b[0],'m1');await frame(810001);assert.equal(store.state.bpHistory.length,1);
});


test('choosing an already queued action moves it forward once and preserves the other future actions',()=>{
 let s=setup();const before=s.queue;assert.equal(before[0].team,'b');
 s=choose(s,'b','ban');assert.equal(s.action.team,'b');assert.deepEqual(s.queue,before.slice(1));
 s=apply(s,'m0');assert.equal(s.action.kind,'pick');assert.equal(s.action.team,'b');
});

test('an old session without poolChoice can undo a newly selected mode completely',()=>{
 let s=setup();delete s.poolChoice;const action=structuredClone(s.action);
 s=choose(s,'b','pick');assert.equal(s.poolChoice.team,'b');
 s=cmd(s,'undo');assert.equal(s.poolChoice,null);assert.deepEqual(s.action,action);
});
