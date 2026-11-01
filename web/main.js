import init, { GameBridge } from './pkg/lower_base.js';
import { BattlefieldRenderer } from './renderer.js';
import { BUILD_INFO } from './pkg/build_config.js';
import { MatchDebugRecorder, createDebugActions } from './match-debug.mjs';
import { Vector3 } from './three.module.js';

const $ = id => document.getElementById(id);
const selected = new Set();
const specs = [
  { kind: 'soldier', short: 'RIFLE', name: 'RIFLE INFANTRY', cost: 60, icon: '<svg viewBox="0 0 48 48"><path fill="#c9b286" d="M18 15h13v13H18z"/><path fill="#6484bc" d="M13 17q0-15 11-15t12 15zM8 44V31l11-6h11l10 6v13z"/><path fill="#243126" d="M18 28h4v16h-4zm10 0h4v16h-4z"/><path stroke="#d5c69d" stroke-width="4" d="m8 39 34-12"/></svg>', key: '3' },
  { kind: 'rocket', short: 'ROCKET', name: 'ROCKET TROOPER', cost: 90, icon: '<svg viewBox="0 0 48 48"><path fill="#252b24" d="M15 36h7v10h-7zm10 0h7v10h-7z"/><path fill="#5f6b72" d="M12 20h22v18H12z"/><path fill="#6484bc" d="M9 18h9v6H9zm19 0h9v6h-9zM15 25h16v7H15z"/><path fill="#56646c" d="M17 7h12v12H17z"/><path fill="#ffa040" d="M18 11h10v3H18z"/><path fill="#55603c" d="M26 9h20v10H26z"/><path fill="#d8392a" d="M42 10h4v3h-4zm0 5h4v3h-4z"/></svg>', key: '4' },
  { kind: 'tank', short: 'TANK', name: 'SIEGE TANK', cost: 150, icon: '<svg viewBox="0 0 48 48"><path fill="#252b24" d="M3 30h42v13H3z"/><path fill="#858979" d="M8 35h4v4H8zm8 0h4v4h-4zm8 0h4v4h-4zm8 0h4v4h-4zm8 0h4v4h-4z"/><path fill="#8c9aa1" d="M4 24h36l6 6H4z"/><path fill="#6484bc" d="M3 29h42v3H3z"/><path fill="#8c9aa1" d="m12 23 3-8h15l4 8z"/><path fill="#6484bc" d="M14 15h17v3H14z"/><path stroke="#c9c6b0" stroke-width="2.5" d="M30 16 46 9M30 20l16-6"/></svg>', key: '5' },
  { kind: 'demolition', short: 'DEMO', name: 'DEMOLITION TRUCK', cost: 250, icon: '<svg viewBox="0 0 48 48"><path fill="#252b24" d="M2 32h44v5H2z"/><path fill="#6484bc" d="M2 17h12v15H2z"/><path fill="#1c2a33" d="M3 19h6v6H3z"/><rect fill="#e3b437" x="16" y="14" width="30" height="17" rx="8"/><path fill="#3a2f27" d="M21 14h3v17h-3zm16 0h3v17h-3z"/><path fill="#b5301f" d="M29 14h3v17h-3z"/><path fill="#ff6b28" d="M6 14h4v3H6z"/><circle fill="#161e1b" cx="9" cy="38" r="5"/><circle fill="#161e1b" cx="27" cy="38" r="5"/><circle fill="#161e1b" cx="39" cy="38" r="5"/></svg>', key: '7' },
  { kind: 'collector', short: 'HARVEST', name: 'ORE COLLECTOR', cost: 200, icon: '<svg viewBox="0 0 48 48"><path fill="#252b24" d="M5 32h38v12H5z"/><path fill="#858979" d="M9 36h4v4H9zm8 0h4v4h-4zm8 0h4v4h-4zm8 0h4v4h-4z"/><path fill="#8c9aa1" d="M16 12h28l-2 20H18z"/><path fill="#6484bc" d="M15 10h30v3H15z"/><path fill="#e9bd4c" d="m19 12 5-6 6 3 5-5 5 8z"/><path fill="#6484bc" d="M6 18h10v12H6z"/><path fill="#1c2a33" d="M8 20h7v4H8z"/><path fill="#e3b437" d="M0 44 6 34h3l-4 10z"/></svg>', key: '6' },
];
let game, renderer, snapshot, lastTime = 0, ended = false, paused = false, demo = false;
const SPEEDS = [0.5, 1, 2, 4];
let speedIndex = 1;
const debugEnabled = BUILD_INFO.development && typeof GameBridge.prototype.debug_snapshot === 'function';
let debugRecorder = null, debugReport = null;
const debugActions = debugEnabled ? createDebugActions(document.querySelector('#game-over .overlay-card'), () => debugReport) : null;
const difficultyDescriptions = {
  easy: 'Slow reactions and small, predictable attack waves.',
  medium: 'Adaptive counters and regular attack waves.',
  hard: 'Adapts its strategy, builds counters, and varies its attacks each match.',
};
for (const input of document.querySelectorAll('input[name="difficulty"]')) {
  input.addEventListener('change', () => {
    $('difficulty-description').textContent = difficultyDescriptions[input.value];
  });
}
function canCommand() { return game && !demo && !paused && !ended && snapshot?.outcome === 'playing'; }
function train(kind) { if (canCommand()) { debugRecorder?.command('train', { kind }, snapshot.time); game.train(kind); refresh(); } }
function buildEmplacement(slot) {
  if (!canCommand()) return;
  debugRecorder?.command('build_emplacement', { slot }, snapshot.time);
  game.build_emplacement(slot);
  refresh();
}
function beginMatch(isDemo = false) {
  demo = isDemo;
  game?.free();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
  game = GameBridge.with_difficulty(seed, difficulty, demo);
  debugReport = null;
  debugActions?.reset();
  debugRecorder = debugEnabled ? new MatchDebugRecorder({
    seed, difficulty, demo, build: BUILD_INFO,
    started_at: new Date().toISOString(),
    browser: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, pixel_ratio: devicePixelRatio },
  }, JSON.parse(game.debug_snapshot())) : null;
  selected.clear();
  snapshot = null;
  ended = false;
  paused = false;
  lastTime = 0;
  resetHud();
  $('main-menu').hidden = true;
  $('app').hidden = false;
  $('app').classList.toggle('demo-mode', demo);
  $('pause-screen').hidden = true;
  $('game-over').classList.add('hidden');
  $('spectator-note').hidden = !demo;
  $('match-label').textContent = `${difficulty.toUpperCase()} · ${demo ? 'AI VS AI' : 'YOUR COMMAND'}`;
  $('restart').textContent = demo ? 'WATCH AGAIN' : 'PLAY AGAIN';
  setHudInert(false);
  try {
    if (!renderer) renderer = new BattlefieldRenderer($('scene'), onSelect, cancelTraining, ejectGarrisoned);
    renderer.reset();
    setSpeed(speedIndex);
    setView('map');
    $('pause').focus();
  } catch (error) {
    console.error(error);
    abortMatch();
    $('menu-status').textContent = 'Unable to render the battlefield. Check that WebGL is available, then try again.';
  }
}
// Everything in the HUD except the pause dialog goes inert while paused.
function setHudInert(value) {
  for (const element of $('app').children) if (element.id !== 'pause-screen') element.inert = value;
}
function abortMatch() {
  debugRecorder = null;
  debugReport = null;
  debugActions?.reset();
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
function setSpeed(index) {
  speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index));
  const speed = SPEEDS[speedIndex], label = `${speed === 0.5 ? '½' : speed}×`;
  $('speed').textContent = label;
  $('speed').setAttribute('aria-label', `Game speed ${speed}x`);
  $('speed').classList.toggle('fast', speed > 1);
  if (renderer) renderer.timeScale = speed;
}
function setPaused(value) {
  if (!game || ended) return;
  paused = value;
  lastTime = 0;
  $('pause-screen').hidden = !paused;
  setHudInert(paused);
  if (!paused) renderer.lastFrame = performance.now();
  refresh();
  $(paused ? 'resume' : 'pause').focus();
}

// Sidebar cameos follow the hotkey order; the anti-tank pads are static markup.
const cameoOrder = ['soldier', 'rocket', 'tank', 'collector', 'demolition'];
function createProduction() {
  const notes = {
    collector: ' — automatically mines ore and delivers credits to your refinery',
    demolition: ' — 6s build, 140 HP. Waits ahead of your line and strikes groups near it; Send it to hit the best target anywhere. Explodes when it strikes or is destroyed: up to 450 damage, radius 7, damages allies. One fielded or queued.',
  };
  const html = cameoOrder.map(kind => specs.find(s => s.kind === kind)).map(s => `<button type="button" class="cameo" id="train-${s.kind}" title="Queue ${s.name}, ${s.cost} credits (${s.key})${notes[s.kind] || ''}">${s.icon.replace('<svg', '<svg class="cameo-icon" aria-hidden="true"')}<span class="cameo-progress" aria-hidden="true"></span><span class="cameo-key" aria-hidden="true">${s.key}</span><span class="cameo-name">${s.short}</span><small class="cameo-cost">${s.cost}</small><span class="cameo-badge" hidden></span>${s.kind === 'demolition' ? '<span id="demolition-status" class="cameo-flag">1×</span>' : ''}</button>`).join('');
  $('production').insertAdjacentHTML('afterbegin', html);
  for (const s of specs) $(`train-${s.kind}`).addEventListener('click', () => train(s.kind));
}
function cancelTraining(building, index) {
  if (!canCommand()) return;
  debugRecorder?.command('cancel_training', { building, index }, snapshot.time);
  game.cancel_training(building, index);
  refresh();
}
function ejectGarrisoned(id) {
  if (!canCommand()) return;
  debugRecorder?.command('eject_garrisoned', { id }, snapshot.time);
  game.eject_garrisoned(id);
  refresh();
}
function setMode(mode) { if (!canCommand()) return; debugRecorder?.command('set_mode', { mode }, snapshot.time); game.set_mode(mode); selected.clear(); refresh(); }
function sendSelected() { if (!canCommand() || !selected.size) return; debugRecorder?.command('attack_selected', { ids: [...selected] }, snapshot.time); game.attack_selected(new Uint32Array([...selected])); selected.clear(); refresh(); }
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
function setText(element, text) { if (element.textContent !== text) element.textContent = text; }

// EVA-style status line: derived from snapshots only, it never affects the match.
const onlineGuns = new Set();
let lastUnitCount = null, statusTimer = 0;
function announce(message) {
  const status = $('hud-status');
  status.textContent = message;
  status.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { status.hidden = true; }, 2200);
}
function resetHud() {
  onlineGuns.clear();
  lastUnitCount = null;
  clearTimeout(statusTimer);
  $('hud-status').hidden = true;
}

// Radar: a top-down plot of the field with the camera footprint. North (hostile) is up.
const RADAR_HALF_X = 26, RADAR_HALF_Z = 56;
const radarCorner = new Vector3(), radarForward = new Vector3();
function drawRadar() {
  const canvas = $('radar');
  const cssWidth = canvas.clientWidth, cssHeight = canvas.clientHeight;
  if (!snapshot || !cssWidth || !cssHeight) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const width = Math.round(cssWidth * ratio), height = Math.round(cssHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  // Stretched to fill the box: a radar reads positions, not exact proportions.
  const sx = width / (RADAR_HALF_X * 2), sz = height / (RADAR_HALF_Z * 2), scale = Math.min(sx, sz);
  const px = x => width / 2 + x * sx, pz = z => height / 2 + z * sz;
  ctx.fillStyle = '#0f1a13';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(86,224,106,.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) { const x = Math.round(width * i / 4) + .5, y = Math.round(height * i / 4) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.moveTo(0, y); ctx.lineTo(width, y); }
  ctx.stroke();
  ctx.fillStyle = '#c9a43a';
  for (const deposit of snapshot.ore) {
    if (deposit.amount <= 0) continue;
    const size = Math.max(1.5 * ratio, (.6 + 1.2 * deposit.amount / deposit.max_amount) * scale);
    ctx.fillRect(px(deposit.x) - size / 2, pz(deposit.z) - size / 2, size, size);
  }
  const colors = { player: '#4a8be6', enemy: '#d4342a' };
  for (const building of snapshot.buildings) {
    if (building.hp <= 0) continue;
    const size = building.kind === 'emplacement' ? 1.8 : 4.2;
    const w = Math.max(3 * ratio, size * sx), h = Math.max(3 * ratio, size * sz);
    ctx.fillStyle = colors[building.team];
    ctx.fillRect(px(building.x) - w / 2, pz(building.z) - h / 2, w, h);
  }
  const dot = Math.max(2, Math.round(1.6 * ratio));
  for (const unit of snapshot.units) {
    if (unit.hp <= 0 || unit.state === 'garrison') continue;
    ctx.fillStyle = selected.has(unit.id) ? '#ffffff' : colors[unit.team];
    ctx.fillRect(Math.round(px(unit.x) - dot / 2), Math.round(pz(unit.z) - dot / 2), dot, dot);
  }
  // Camera footprint on the ground plane.
  const camera = renderer?.camera;
  if (!camera) return;
  camera.getWorldDirection(radarForward);
  ctx.strokeStyle = '#e8ebed';
  ctx.lineWidth = Math.max(1, ratio);
  ctx.beginPath();
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y], index) => {
    radarCorner.set(x, y, -1).unproject(camera);
    const t = -radarCorner.y / radarForward.y;
    const gx = px(radarCorner.x + radarForward.x * t), gz = pz(radarCorner.z + radarForward.z * t);
    if (index) ctx.lineTo(gx, gz); else ctx.moveTo(gx, gz);
  });
  ctx.closePath();
  ctx.stroke();
}

function refresh() {
  if (!game) return;
  snapshot = JSON.parse(game.snapshot());
  if (snapshot.outcome === 'playing') debugRecorder?.observe(snapshot, () => JSON.parse(game.debug_snapshot()));
  const selectable = new Set(snapshot.units.filter(u => u.team === 'player' && u.state === 'gather').map(u => u.id));
  for (const id of selected) if (!selectable.has(id)) selected.delete(id);
  $('credits').textContent = Math.floor(snapshot.credits).toLocaleString();
  const seconds = Math.floor(snapshot.time);
  $('clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  for (const mode of ['gather', 'attack', 'retreat']) {
    $(mode).disabled = !canCommand();
    $(mode).classList.toggle('active', snapshot.mode === mode);
    $(mode).setAttribute('aria-pressed', String(snapshot.mode === mode));
  }
  $('selected-count').textContent = String(selected.size);
  $('send-selected').disabled = !selected.size || !canCommand() || snapshot.mode === 'retreat';
  const refinery = snapshot.buildings.some(b => b.team === 'player' && b.kind === 'refinery');
  const collectors = snapshot.units.filter(u => u.team === 'player' && u.kind === 'collector').length;
  const sheltered = snapshot.units.filter(u => u.team === 'player' && u.state === 'garrison').length;
  $('economy-status').textContent = `${collectors} COLLECTOR${collectors === 1 ? '' : 'S'} · REFINERY ${refinery ? 'ONLINE' : 'LOST'}${sheltered ? ` · ${sheltered} INSIDE` : ''}`;
  const demolitionQueued = snapshot.factory_queue.includes('demolition');
  const demolitionAlive = snapshot.units.some(u => u.team === 'player' && u.kind === 'demolition');
  setText($('demolition-status'), demolitionAlive ? 'ACTIVE' : demolitionQueued ? 'QUEUED' : '1×');
  for (const s of specs) {
    const building = ['tank', 'collector', 'demolition'].includes(s.kind) ? 'factory' : 'barracks';
    const queue = building === 'factory' ? snapshot.factory_queue : snapshot.barracks_queue;
    const producer = snapshot.buildings.find(b => b.team === 'player' && b.kind === building && b.hp > 0);
    const occupants = snapshot.units.filter(u => u.team === 'player' && u.hp > 0 && u.state === 'garrison' && u.garrison === producer?.id).length;
    const cameo = $(`train-${s.kind}`);
    cameo.disabled = !canCommand() || snapshot.credits < s.cost || queue.length + occupants >= 9 || (s.kind === 'demolition' && (demolitionAlive || demolitionQueued)) || (s.kind === 'collector' && !refinery) || !producer;
    // Badge: how many of this unit are queued. The head of a queue shows a build sweep.
    const queued = queue.filter(kind => kind === s.kind).length;
    const badge = cameo.querySelector('.cameo-badge');
    badge.hidden = !queued;
    setText(badge, String(queued));
    const head = queue[0] === s.kind;
    cameo.classList.toggle('is-building', head);
    if (head) cameo.style.setProperty('--progress', Math.min(1, snapshot[`${building}_progress`] || 0));
  }
  for (const [team, prefix] of [['player', 'friendly'], ['enemy', 'enemy']]) {
    const units = snapshot.units.filter(u => u.team === team);
    const buildings = snapshot.buildings.filter(b => b.team === team);
    $(`${prefix}-units`).textContent = units.length;
    $(`${prefix}-buildings`).textContent = buildings.length;
    $(`${prefix}-bar`).style.width = `${Math.max(0, Math.min(100, buildings.filter(b => b.kind !== 'emplacement').reduce((a,b) => a + b.hp / b.max_hp, 0) / 4 * 100))}%`;
  }
  const command = snapshot.buildings.some(b => b.team === 'player' && b.kind === 'command');
  for (const slot of [0, 1]) {
    const gun = snapshot.buildings.find(b => b.team === 'player' && b.defense_slot === slot);
    const button = $(`defense-${slot}`);
    const online = !!gun && gun.construction_remaining <= 0;
    const building = !!gun && gun.construction_remaining > 0;
    button.disabled = !canCommand() || !!gun || !command || snapshot.credits < 200;
    button.classList.toggle('online', online);
    button.classList.toggle('is-building', building);
    if (building) button.style.setProperty('--progress', Math.max(0, Math.min(1, 1 - gun.construction_remaining / 8)));
    setText(button.querySelector('.cameo-cost'), online ? 'ONLINE' : building ? `${Math.ceil(gun.construction_remaining)}s` : command ? '200' : 'LOST');
    if (online && !onlineGuns.has(slot) && !demo) announce('CONSTRUCTION COMPLETE');
    if (online) onlineGuns.add(slot); else onlineGuns.delete(slot);
  }
  const playerUnits = snapshot.units.filter(u => u.team === 'player').length;
  if (lastUnitCount !== null && playerUnits > lastUnitCount && !demo) announce('UNIT READY');
  lastUnitCount = playerUnits;
  drawRadar();
  if (!paused) renderer.update(snapshot, selected);
  $('pause').disabled = snapshot.outcome !== 'playing';
  if (snapshot.outcome !== 'playing' && !ended) {
    ended = true;
    if (debugRecorder) {
      const report = debugRecorder.finish(JSON.parse(game.debug_snapshot()));
      debugReport = {
        text: JSON.stringify(report, null, 2),
        filename: `lower-base-${report.metadata.seed}-${snapshot.outcome}-debug.json`,
      };
      debugActions.show();
    }
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
    if (!ended) {
      // The simulation clamps one update to 0.25s, so feed scaled time in 0.1s chunks.
      for (let remaining = dt * SPEEDS[speedIndex]; remaining > 1e-4;) {
        const step = Math.min(remaining, .1);
        game.update(step); debugRecorder?.updated(step);
        remaining -= step;
      }
      refresh();
    }
    else renderer.update(snapshot, selected);
  }
  requestAnimationFrame(frame);
}
$('gather').addEventListener('click', () => setMode('gather'));
$('attack').addEventListener('click', () => setMode('attack'));
$('retreat').addEventListener('click', () => setMode('retreat'));
$('send-selected').addEventListener('click', sendSelected);
for (const slot of [0, 1]) $(`defense-${slot}`).addEventListener('click', () => buildEmplacement(slot));
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
$('speed').addEventListener('click', event => setSpeed((speedIndex + (event.shiftKey ? SPEEDS.length - 1 : 1)) % SPEEDS.length));
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
  if (event.key === '+' || event.key === '=') { setSpeed(speedIndex + 1); return; }
  if (event.key === '-' || event.key === '_') { setSpeed(speedIndex - 1); return; }
  if (!canCommand()) return;
  if (event.key === '1') setMode('gather');
  if (event.key === '2') setMode('attack');
  if (event.key.toLowerCase() === 'r') setMode('retreat');
  const spec = specs.find(s => s.key === event.key);
  if (spec) train(spec.kind);
  if (event.key === '8') buildEmplacement(0);
  if (event.key === '9') buildEmplacement(1);
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
