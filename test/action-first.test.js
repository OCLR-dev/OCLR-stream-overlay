import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../server/session/store.js';
import { newCustomSession, newSession, transition, currentRound, bpProgress, seriesOf } from '../server/session/model.js';
const pool=Array.from({length:15},(_,i)=>({id:`m${i}`,label:`NM${i+1}`,mod:'NM',beatmapId:810000+i}));
const cmd=(s,type,payload={})=>transition(s,{id:randomUUID(),version:s.version,type,payload});
function setup(simple=true){let s=newCustomSession();for(const [field,value] of [['bestOf',9],['pool',pool]])s=cmd(s,'setting',{field,value});if(simple)s=cmd(s,'set-bp-preset',{value:'single-ban-alternate'});return s;}
const select=(s,team,kind)=>cmd(s,'select-bp-action',{team,kind});
const apply=(s,i)=>cmd(s,'apply-bp',{entryId:`m${i}`,actionId:s.action?.id});
const signature=s=>s.action&&[s.action.team,s.action.kind,s.action.slot];
function finished(s){return cmd(cmd(s,'start'),'ranking');}

test('action-first single Ban workflow: two explicit Bans then alternate Picks, no second Bans or queue entry',()=>{
 let s=setup();assert.equal(s.action,null);s=select(s,'b','ban');assert.equal(s.poolMarks.length,0);assert.equal(s.rounds.length,0);
 assert.deepEqual(signature(s),['b','ban',0]);s=apply(s,0);assert.deepEqual(signature(s),['a','ban',0]);
 s=apply(s,1);assert.equal(s.action,null);assert.match(bpProgress(s).waiting,/先 Pick/);
 s=select(s,'b','pick');assert.deepEqual(signature(s),['b','pick',null]);
 for(let i=2;i<8;i++){assert.equal(s.action.kind,'pick');assert.equal(s.action.team,i%2===0?'b':'a');s=apply(s,i);s=finished(s);}
 assert.equal(s.bpHistory.filter(h=>h.kind==='ban').length,2);assert.deepEqual(seriesOf(s),{a:0,b:0});
 const marked=select(s,'a','ban');assert.deepEqual(marked.rounds,s.rounds);assert.deepEqual(marked.poolChoice,{team:'a',kind:'ban'});
});
test('independent first choices may be provided by Roll; first Pick can be supplied while the second Ban waits',()=>{
 let s=setup();s=select(s,'b','ban');s=apply(s,0);
 s=cmd(s,'set-roll',{winner:null,banFirst:'b',pickFirst:'b'});s=apply(s,1);assert.deepEqual(signature(s),['b','pick',null]);
});
test('empty Ban counts once and undo restores it; a late join may select a current Pick without fabricating Bans',()=>{
 let s=setup();s=select(s,'a','ban');const joined=select(s,'b','pick');assert.equal(joined.action.kind,'pick');assert.deepEqual(joined.bans,s.bans);
 s=cmd(s,'skip-ban',{actionId:s.action.id,reason:'裁判确认空 Ban'});const after=s.action;
 s=cmd(s,'undo');assert.deepEqual(signature(s),['a','ban',0]);s=apply(s,0);assert.equal(s.action.team,after.team);
});
test('prepared replacement, replay, result correction and selection correction preserve exactly one Pick',()=>{
 let s=apply(select(setup(),'a','ban'),0);s=apply(s,1);s=select(s,'a','pick');s=apply(s,2);
 const picked=currentRound(s);s=select(s,'b','pick');assert.deepEqual(currentRound(s),picked);assert.equal(s.action,null);
 s=apply(s,3);assert.equal(currentRound(s).actionId,picked.actionId);s=finished(s);const next=s.action;
 s=cmd(s,'referee-replay',{reason:'裁判确认重赛'});s=finished(s);assert.deepEqual(s.action,next);
 s=select(s,'a','pick');s=apply(s,4);s=finished(s);assert.equal(s.action.team,'b');
 const old=s.rounds.find(r=>r.id===s.currentRoundId);s=cmd(s,'record-result',{roundId:old.id,winner:'b',keepDisplay:true});assert.equal(s.action.team,'b');
});
test('adopting the simple preset preserves two existing first Bans; second-round Ban history is rejected',()=>{
 let s=setup(false);s=apply(select(s,'a','ban'),0);s=apply(select(s,'b','ban'),1);
 const history=s.bpHistory;s=cmd(s,'set-bp-preset',{value:'single-ban-alternate'});assert.deepEqual(s.bpHistory,history);s=select(s,'a','pick');assert.equal(s.queue[0].team,'b');
 let bad=setup(false);bad=apply(select(bad,'a','ban'),0);bad=apply(select(bad,'a','ban'),1);
 assert.throws(()=>cmd(bad,'set-bp-preset',{value:'single-ban-alternate'}),/第二轮 Ban/);
});
test('OCLR action-first arming preserves its Roll-generated future flow and marks no map',()=>{
 let s=cmd(newSession(),'setup',{title:'隔离LR回归',stage:'group',mode:'4v4',source:'4x3',teams:{a:{name:'Red',roster:[]},b:{name:'Blue',roster:[]}},pool});
 s=cmd(s,'set-roll',{winner:null,banFirst:'a',pickFirst:'b'});const queue=s.queue,flow=s.bpFlow;
 s=select(s,'a','ban');assert.deepEqual(s.queue,queue);assert.deepEqual(s.bpFlow,flow);assert.equal(s.bans.b[0],null);assert.equal(s.bpHistory.length,0);
 s=cmd(s,'undo');assert.deepEqual(signature(s),['a','ban',0]);
});
test('old pending map cannot execute a newly selected action; a fresh stable change can',async()=>{
 const store=new SessionStore({state:select(setup(),'a','ban')});let now=0;
 const frame=map=>store.frame({beatmap:{id:map},tourney:{ipcState:1,teams:{left:'L',right:'R'},players:[{side:'left',osuId:1},{side:'right',osuId:2}],totalScore:{left:0,right:0}}},now+=500);
 const send=(type,payload)=>store.command({id:randomUUID(),version:store.state.version,type,payload});
 await send('auto',{...store.state.auto,profile:'stable-tourney',left:'L',right:'R'});await frame(899999);await frame(810000);
 await send('select-bp-action',{team:'b',kind:'ban'});await frame(810000);assert.equal(store.state.bpHistory.length,0);
 await frame(810001);await frame(810001);assert.equal(store.state.bans.b[0],'m1');
});

test('repairing a cleared first Ban mid-series resumes the pending Pick rather than restarting the first rotation',()=>{
 let s=apply(select(setup(),'a','ban'),0);s=apply(s,1);s=select(s,'a','pick');s=finished(apply(s,2));
 assert.equal(s.action.team,'b');s=cmd(s,'clear-ban',{team:'a',slot:0,reason:'核对首 Ban'});s=select(s,'a','ban');s=apply(s,3);
 assert.equal(s.action.kind,'pick');assert.equal(s.action.team,'b');
});


test('old custom sessions can undo a newly selected mode without leaving its broadcast choice',()=>{
 let s=setup();delete s.poolChoice;const action=structuredClone(s.action);s=select(s,'b','pick');
 s=cmd(s,'undo');assert.equal(s.poolChoice,null);assert.deepEqual(s.action,action);
});
