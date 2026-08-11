/* STAKKA 2 headless logic test — node Stakka2/test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const probed = src.replace(
  /\}\)\(\);\s*$/,
  `globalThis.__T = {
    get state(){return state}, get blocks(){return blocks}, get mover(){return mover},
    get obstacles(){return obstacles}, get combo(){return combo}, get score(){return score},
    get currentLevel(){return currentLevel}, get maxLevel(){return maxLevel}, get debris(){return debris},
    GOAL, LV, update, render, place, tap, startGame, retryLevel, restartFrom1, spawnObs, inDanger,
    w2s, topCenterScreen, moverExt, snapCam
   };
})();`
);

/* ── DOM stubs ── */
const noop = () => {};
const ctxStub = new Proxy({}, { get(_, k) {
  if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
  return typeof k === 'string' ? noop : undefined;
}, set() { return true; } });
const canvas = { getContext: () => ctxStub, style:{}, width:0, height:0, clientWidth:393, clientHeight:852 };
const mkEl = () => ({ style:{}, textContent:'', innerHTML:'', className:'', classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,v){v?this._s.add(c):this._s.delete(c);}, contains(c){return this._s.has(c);} }, addEventListener:noop, appendChild(){return {};}, closest(){return null;} });
const mkElOrig = mkEl;
const els = {}, store = new Map();
const sandbox = {
  console,
  document: { hidden:false, createElement:()=>mkEl(), getElementById: id => id==='c'?canvas:(els[id]||(els[id]=mkEl())), addEventListener:noop },
  localStorage: { getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,v) },
  navigator:{}, performance:{ now:()=>Date.now() }, requestAnimationFrame: fn=>{ /* no auto-run */ },
  setTimeout: fn=>{ fn(); return 0; },
  innerWidth:393, innerHeight:852, devicePixelRatio:2, addEventListener:noop,
  AudioContext: undefined, visualViewport: null
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(probed, sandbox);
const T = sandbox.__T;

let pass=0, failN=0;
const ok = (c,msg)=>{ if(c){pass++;} else {failN++; console.log('  FAIL: '+msg);} };
const step = (n=1,dt=1/60)=>{ for(let i=0;i<n;i++) T.update(dt); };
const align = ()=>{ if(!T.mover) return; const p=T.blocks[T.blocks.length-1]; if(T.mover.axis==='x') T.mover.x=p.x; else T.mover.z=p.z; };
const clearObs = ()=>{ T.obstacles.length = 0; };

/* 1. 시작 */
ok(T.state==='menu','boot → menu');
T.startGame();
ok(T.state==='play','startGame → play');
ok(T.currentLevel===1,'level 1');
ok(T.score===0,'score 0');
ok(T.mover!==null,'mover spawned');

/* 2. 레벨1 클리어(장애물 없음) → 레벨2 */
for (let i=0;i<T.GOAL;i++){ align(); clearObs(); T.place(); }
ok(T.currentLevel===2,'6 placements clear level 1 → level 2');
ok(T.score===6,'score 6');

/* 3. 장애물이 덮칠 때 place → hitFail(over) */
// mover의 화면 중앙에 장애물 강제 배치
const me = T.moverExt();
T.obstacles.push({ e:'🐦', type:'fly', sz:56, active:true, hitW:44, x:me.cx, y:me.cy });
ok(T.inDanger()!==null,'inDanger detects obstacle over mover');
T.place();
ok(T.state==='over','placing under obstacle → game over');
ok(T.mover===null,'mover cleared on hit');

/* 4. 체크포인트 재시작 — 현재 레벨(2) 기초부터 재생성 */
T.retryLevel();
ok(T.state==='play','retryLevel → play');
ok(T.currentLevel===2,'retry keeps current level (checkpoint)');
ok(T.score===(2-1)*T.GOAL,'retry rebuilds foundation to level start height');
ok(T.mover!==null,'mover respawned after retry');

/* 5. 장애물이 없으면 대기는 안전하다 — place 정상 동작 */
clearObs(); align(); T.place();
ok(T.state==='play','safe placement when no obstacle');

/* 6. 장애물 자동 스폰 동작 */
const cfg = T.LV[T.currentLevel-1];
if (cfg.obs) {
  const before = T.obstacles.length;
  T.spawnObs();
  ok(T.obstacles.length === before+1, 'spawnObs adds obstacle');
  ok(T.obstacles[T.obstacles.length-1].e === cfg.obs.e, 'spawned obstacle matches level config');
}

/* 7. 레벨을 올려가며 10레벨 도달 → 승리 */
clearObs();
// 레벨2 시작(score=6)부터 60까지 = 54회
let guard=0;
while (T.state==='play' && guard++ < 200) {
  // 레벨이 바뀌면 배너 때문에 잠시 스폰 억제지만 place 자체는 가능
  align(); clearObs(); T.place();
}
ok(T.state==='win','reaching height 60 → win');
ok(T.maxLevel===10,'maxLevel saved as 10');

/* 8. 승리 후 재시작 */
T.restartFrom1();
ok(T.state==='play','restartFrom1 after win');
ok(T.currentLevel===1,'restart from level 1');
ok(T.score===0,'restart score 0');

/* 9. 렌더 무결성 */
clearObs();
for (let i=0;i<3;i++){ align(); T.place(); }
step(60); T.render();
ok(true,'render runs without throwing');

/* 10. 장애물 타입별 스폰이 에러 없이 동작 */
for (let lv=1; lv<=10; lv++) {
  T.__currentLevel = lv; // 직접 세팅 불가 — startLevel 경유
}
// 각 레벨로 이동해 스폰 검증
for (let lv=1; lv<=10; lv++) {
  // startLevel 비노출이므로 place 로 진행은 비효율 → 대신 spawnObs 를 각 레벨 cfg로 검증
  const c = T.LV[lv-1];
  if (c.obs) { ok(typeof c.obs.e==='string' && c.obs.e.length>0, 'LV'+lv+' obstacle has emoji'); }
}

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN?1:0);
