import init, { GameBridge } from './pkg/lower_base.js';
import { BattlefieldRenderer } from './renderer.js';

const $ = id => document.getElementById(id);
const selected = new Set();
const specs = [
  { kind: 'soldier', name: 'RIFLE INFANTRY', cost: 60, icon: '<svg viewBox="0 0 48 48"><path fill="#c9b286" d="M18 15h13v13H18z"/><path fill="#6484bc" d="M13 17q0-15 11-15t12 15zM8 44V31l11-6h11l10 6v13z"/><path fill="#243126" d="M18 28h4v16h-4zm10 0h4v16h-4z"/><path stroke="#d5c69d" stroke-width="4" d="m8 39 34-12"/></svg>', key: '3' },
  { kind: 'rocket', name: 'ROCKET TROOPER', cost: 90, icon: '<svg viewBox="0 0 48 48"><path fill="#9aa477" d="m5 34 30-25 9 10-30 25z"/><path fill="#ddd09c" d="m28 15 7-6 9 10-7 6z"/><path fill="#252b24" d="m36 8 9 10 3-4-9-9zM15 31l7 8-5 7-8-8z"/></svg>', key: '4' },
  { kind: 'tank', name: 'SIEGE TANK', cost: 150, icon: '<svg viewBox="0 0 48 48"><path fill="#252b24" d="M3 26h42v17H3z"/><path fill="#a2aa7d" d="m6 24 5-7h26l6 7v11H6z"/><path fill="#6484bc" d="m15 15 4-7h15l5 7v8H15z"/><path stroke="#d4cfac" stroke-width="5" d="M26 14 44 4"/><path stroke="#858979" stroke-width="3" stroke-dasharray="5 3" d="M6 39h36"/></svg>', key: '5' },
  { kind: 'demolition', name: 'DEMOLITION TRUCK', cost: 250, icon: '<svg viewBox="0 0 48 48"><path fill="#252b24" d="M3 29h42v12H3z"/><path fill="#6484bc" d="M3 20h12l5 10H3z"/><path fill="#b74f32" d="M21 12h22v21H21z"/><path fill="#e9c76a" d="m24 14 5 5-5 5 5 5h6l-5-5 5-5-5-5zm12 0 5 5-5 5 5 5h2V14z"/><path fill="#cbd1ac" d="M6 22h7l3 6H6z"/><circle fill="#161e1b" cx="11" cy="37" r="6"/><circle fill="#161e1b" cx="36" cy="37" r="6"/></svg>', key: '7' },
  { kind: 'collector', name: 'ORE COLLECTOR', cost: 200, icon: '<svg viewBox="0 0 48 48"><path fill="#252b24" d="M3 29h42v13H3z"/><path fill="#a2aa7d" d="M4 16h27v18H4z"/><path fill="#6484bc" d="M31 22h9l5 7v5H31z"/><path fill="#e9bd4c" d="m8 15 5-8 7 4 5-6 4 10z"/><path fill="#cbd1ac" d="M34 24h5l3 5h-8z"/><circle fill="#161e1b" cx="12" cy="37" r="6"/><circle fill="#161e1b" cx="36" cy="37" r="6"/></svg>', key: '6' },
];
let game, renderer, snapshot, lastTime = 0, ended = false, paused = false, demo = false;
function canCommand() { return game && !demo && !paused && !ended && snapshot?.outcome === 'playing'; }
function train(kind) { if (canCommand()) { game.train(kind); refresh(); } }
function beginMatch(isDemo = false) {
  demo = isDemo;
  game?.free();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  game = demo ? GameBridge.demo(seed) : new GameBridge(seed);
  selected.clear();
  snapshot = null;
  ended = false;
  paused = false;
  lastTime = 0;
  $('main-menu').hidden = true;
  $('app').hidden = false;
  $('app').classList.toggle('demo-mode', demo);
  $('pause-screen').hidden = true;
  $('game-over').classList.add('hidden');
  $('spectator-note').hidden = !demo;
  $('match-label').textContent = demo ? 'DEMO · AI VS AI' : 'YOUR COMMAND';
  $('restart').textContent = demo ? 'WATCH AGAIN' : 'PLAY AGAIN';
  document.querySelector('.topbar').inert = false;
  document.querySelector('.layout').inert = false;
  try {
    if (!renderer) renderer = new BattlefieldRenderer($('scene'), onSelect);
    renderer.reset();
    setView('map');
    $('pause').focus();
  } catch (error) {
    console.error(error);
    abortMatch();
    $('menu-status').textContent = 'Unable to render the battlefield. Check that WebGL is available, then try again.';
  }
}
function abortMatch() {
  game?.free();
  game = null;
  snapshot = null;
  selected.clear();
  paused = false;
  ended = false;
  lastTime = 0;
  $('pause-screen').hidden = true;
  $('app').hidden = true;
  $('main-menu').hidden = false;
  $('start-game').focus();
}
function setPaused(value) {
  if (!game || ended) return;
  paused = value;
  lastTime = 0;
  $('pause-screen').hidden = !paused;
  document.querySelector('.topbar').inert = paused;
  document.querySelector('.layout').inert = paused;
  if (!paused) renderer.lastFrame = performance.now();
  refresh();
  $(paused ? 'resume' : 'pause').focus();
}

function createProduction() {
  $('production').innerHTML = specs.map(s => `<button type="button" class="unit-card" id="train-${s.kind}" title="Queue ${s.name} (${s.key})${s.kind === 'collector' ? ' — automatically mines ore and delivers credits to your refinery' : s.kind === 'demolition' ? ' — 6s build, 140 HP. Explodes on attack or death: up to 450 damage, radius 7, damages allies. One fielded or queued.' : ''}"><span class="unit-art" aria-hidden="true">${s.icon}</span><span class="unit-info"><strong>${s.name}</strong>${s.kind === 'demolition' ? '<small id="demolition-status">FRIENDLY FIRE · LIMIT 1</small>' : ''}</span><span class="unit-cost">◆ ${s.cost}</span></button>`).join('') + '<div class="queue-label">BARRACKS <strong id="barracks-queue">—</strong> &nbsp; / &nbsp; FACTORY <strong id="factory-queue">—</strong></div><div class="economy-note"><span id="economy-status"></span><span>Collectors mine ore. Demo trucks explode on attack or death, damaging allies too. One per player.</span></div>';
  for (const s of specs) $(`train-${s.kind}`).addEventListener('click', () => train(s.kind));
}
function queueText(queue) { return queue.length ? queue.map(k => ({soldier:'RIFLE', rocket:'ROCKET', tank:'TANK', collector:'COLLECTOR', demolition:'DEMO'}[k])).join(' › ') : 'IDLE'; }
function setMode(mode) { if (!canCommand()) return; game.set_mode(mode); selected.clear(); refresh(); }
function sendSelected() { if (!canCommand() || !selected.size) return; game.attack_selected(new Uint32Array([...selected])); selected.clear(); refresh(); }
function onSelect(id, additive, touch) {
  if (!canCommand()) return;
  // A tap on open ground clears the selection; a tap on a unit toggles it.
  if (id === null) {
    if (!additive || touch) selected.clear();
  } else if (additive) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
  } else {
    selected.clear();
    selected.add(id);
  }
  refresh();
}
function refresh() {
  if (!game) return;
  snapshot = JSON.parse(game.snapshot());
  const selectable = new Set(snapshot.units.filter(u => u.team === 'player' && u.state === 'gather').map(u => u.id));
  for (const id of selected) if (!selectable.has(id)) selected.delete(id);
  $('credits').textContent = Math.floor(snapshot.credits).toLocaleString();
  const seconds = Math.floor(snapshot.time);
  $('clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  for (const mode of ['gather', 'attack']) {
    $(mode).disabled = !canCommand();
    $(mode).classList.toggle('active', snapshot.mode === mode);
    $(mode).setAttribute('aria-pressed', String(snapshot.mode === mode));
  }
  $('selected-count').textContent = String(selected.size).padStart(2, '0');
  $('send-selected').disabled = !selected.size || !canCommand();
  $('barracks-queue').textContent = queueText(snapshot.barracks_queue);
  $('factory-queue').textContent = queueText(snapshot.factory_queue);
  const refinery = snapshot.buildings.some(b => b.team === 'player' && b.kind === 'refinery');
  const collectors = snapshot.units.filter(u => u.team === 'player' && u.kind === 'collector').length;
  $('economy-status').textContent = `${collectors} COLLECTOR${collectors === 1 ? '' : 'S'} · REFINERY ${refinery ? 'ONLINE' : 'LOST'}`;
  const demolitionQueued = snapshot.factory_queue.includes('demolition');
  const demolitionAlive = snapshot.units.some(u => u.team === 'player' && u.kind === 'demolition');
  $('demolition-status').textContent = demolitionAlive ? 'ACTIVE · LIMIT 1' : demolitionQueued ? 'QUEUED · LIMIT 1' : 'FRIENDLY FIRE · LIMIT 1';
  for (const s of specs) {
    const building = ['tank', 'collector', 'demolition'].includes(s.kind) ? 'factory' : 'barracks';
    const queue = building === 'factory' ? snapshot.factory_queue : snapshot.barracks_queue;
    $(`train-${s.kind}`).disabled = !canCommand() || snapshot.credits < s.cost || queue.length >= 8 || (s.kind === 'demolition' && (demolitionAlive || demolitionQueued)) || (s.kind === 'collector' && !refinery) || !snapshot.buildings.some(b => b.team === 'player' && b.kind === building);
  }
  for (const [team, prefix] of [['player', 'friendly'], ['enemy', 'enemy']]) {
    const units = snapshot.units.filter(u => u.team === team);
    const buildings = snapshot.buildings.filter(b => b.team === team);
    $(`${prefix}-units`).textContent = units.length;
    $(`${prefix}-buildings`).textContent = buildings.length;
    $(`${prefix}-bar`).style.width = `${Math.max(0, Math.min(100, buildings.reduce((a,b) => a + b.hp / b.max_hp, 0) / 4 * 100))}%`;
  }
  if (!paused) renderer.update(snapshot, selected);
  $('pause').disabled = snapshot.outcome !== 'playing';
  if (snapshot.outcome !== 'playing' && !ended) {
    ended = true;
    const victory = snapshot.outcome === 'victory';
    $('result-title').textContent = demo ? (victory ? 'BLUE WINS' : 'RED WINS') : (victory ? 'VICTORY' : 'DEFEAT');
    $('game-over').classList.remove('hidden');
    $('restart').focus();
  }
}
function frame(now) {
  if (!lastTime) lastTime = now;
  const dt = Math.min((now - lastTime) / 1000, .1); lastTime = now;
  if (game && !paused) {
    if (!ended) { game.update(dt); refresh(); }
    else renderer.update(snapshot, selected);
  }
  requestAnimationFrame(frame);
}
$('gather').addEventListener('click', () => setMode('gather'));
$('attack').addEventListener('click', () => setMode('attack'));
$('send-selected').addEventListener('click', sendSelected);
function setView(view) {
  if (!renderer || !game || paused) return;
  renderer.setView(view);
  for (const option of ['map', 'base']) {
    $(`${option}-view`).classList.toggle('active', option === view);
    $(`${option}-view`).setAttribute('aria-pressed', String(option === view));
  }
  refresh();
}
$('map-view').addEventListener('click', () => setView('map'));
$('base-view').addEventListener('click', () => setView('base'));
$('start-game').addEventListener('click', () => beginMatch());
$('start-demo').addEventListener('click', () => beginMatch(true));
$('restart').addEventListener('click', () => beginMatch(demo));
$('pause').addEventListener('click', () => setPaused(true));
$('resume').addEventListener('click', () => setPaused(false));
for (const id of ['abort', 'pause-abort', 'end-menu']) $(id).addEventListener('click', abortMatch);
window.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || !game) return;
  if (event.key.toLowerCase() === 'p' || (paused && event.key === 'Escape')) {
    event.preventDefault();
    setPaused(!paused);
    return;
  }
  if (paused) {
    if (event.key === 'Tab') {
      event.preventDefault();
      $(document.activeElement === $('resume') ? 'pause-abort' : 'resume').focus();
    }
    return;
  }
  if (!canCommand()) return;
  if (event.key === '1') setMode('gather');
  if (event.key === '2') setMode('attack');
  const spec = specs.find(s => s.key === event.key);
  if (spec) train(spec.kind);
  if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) sendSelected();
  if (event.key === 'Escape') { selected.clear(); refresh(); }
});
async function start() {
  try {
    await init();
    createProduction();
    $('start-game').disabled = false;
    $('start-demo').disabled = false;
    $('menu-status').textContent = 'READY FOR COMMAND';
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    $('menu-status').textContent = 'Unable to load the game. Build the WebAssembly files and serve this page over HTTP; see the README.';
  }
}
start();
