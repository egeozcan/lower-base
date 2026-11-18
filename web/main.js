import init, { GameBridge } from './pkg/lower_base.js';
import { BattlefieldRenderer } from './renderer.js';
import { BUILD_INFO } from './pkg/build_config.js';
import { MatchDebugRecorder, createDebugActions } from './match-debug.mjs';
import { Vector3 } from './three.module.js';
import { GameAudio } from './audio.js';

const $ = id => document.getElementById(id);
const selected = new Set();
const specs = [
  {
    kind: 'soldier', short: 'RIFLE INFANTRY', name: 'RIFLE INFANTRY', cost: 60, key: '3',
  },
  {
    kind: 'rocket', short: 'ROCKET TROOPER', name: 'ROCKET TROOPER', cost: 90, key: '4',
  },
  {
    kind: 'tank', short: 'SIEGE TANK', name: 'SIEGE TANK', cost: 150, key: '5',
  },
  {
    kind: 'demolition', short: 'DEMO TRUCK', name: 'DEMOLITION TRUCK', cost: 250, key: '7',
  },
  {
    kind: 'collector', short: 'ORE COLLECTOR', name: 'ORE COLLECTOR', cost: 200, key: '6',
  },
];
let game, renderer, snapshot, lastTime = 0, ended = false, paused = false, demo = false, showcase = null;
window.__lowerBase = { get renderer() { return renderer; }, get game() { return game; } };
const audio = new GameAudio();
// Browsers start audio only from a user gesture, so every gesture offers one.
for (const type of ['pointerdown', 'pointerup', 'keydown', 'click']) {
  window.addEventListener(type, () => audio.unlock(), { capture: true });
}
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
const modeDescriptions = {
  deathmatch: 'Full bases from the start and a large income. Build armies and guns.',
  standard: 'Start with a command center and little income. Construct your refinery, barracks and factory.',
};
for (const input of document.querySelectorAll('input[name="game-mode"]')) {
  input.addEventListener('change', () => {
    audio.play('click');
    $('mode-description').textContent = modeDescriptions[input.value];
  });
}
// Site structures in build order, with their hotkeys.
const structures = [
  { kind: 'refinery', key: 'g', cost: 600 },
  { kind: 'barracks', key: 'b', cost: 400 },
  { kind: 'factory', key: 'f', cost: 800 },
];
for (const input of document.querySelectorAll('input[name="difficulty"]')) {
  input.addEventListener('change', () => {
    audio.play('click');
    $('difficulty-description').textContent = difficultyDescriptions[input.value];
  });
}
function canCommand() { return game && !demo && !paused && !ended && snapshot?.outcome === 'playing'; }
// The simulation accepts or refuses an order; the sound says which.
const queued = () => snapshot.barracks_queue.length + snapshot.factory_queue.length;
const structureCount = () => snapshot.buildings.filter(b => b.team === 'player').length;
function train(kind) {
  if (!canCommand()) return;
  const before = queued();
  debugRecorder?.command('train', { kind }, snapshot.time);
  game.train(kind);
  refresh();
  audio.play(queued() > before ? 'queue' : 'denied');
}
function buildEmplacement(slot) {
  if (!canCommand()) return;
  const before = structureCount();
  debugRecorder?.command('build_emplacement', { slot }, snapshot.time);
  game.build_emplacement(slot);
  refresh();
  audio.play(structureCount() > before ? 'build' : 'denied');
}
function construct(kind) {
  if (!canCommand() || snapshot.game_mode !== 'standard') return;
  const before = structureCount();
  debugRecorder?.command('construct', { kind }, snapshot.time);
  game.construct(kind);
  refresh();
  audio.play(structureCount() > before ? 'build' : 'denied');
}
const finished = building => building.hp > 0 && building.construction_remaining <= 0;
function beginMatch(isDemo = false) {
  demo = isDemo;
  game?.free();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
  const gameMode = document.querySelector('input[name="game-mode"]:checked').value;
  game = GameBridge.with_options(seed, difficulty, gameMode, demo);
  debugReport = null;
  debugActions?.reset();
  debugRecorder = debugEnabled ? new MatchDebugRecorder({
    seed, difficulty, game_mode: gameMode, demo, build: BUILD_INFO,
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
  $('app').classList.toggle('standard-mode', gameMode === 'standard');
  $('pause-screen').hidden = true;
  $('game-over').classList.add('hidden');
  $('spectator-note').hidden = !demo;
  $('match-label').textContent = `${gameMode.toUpperCase()} · ${difficulty.toUpperCase()} · ${demo ? 'AI VS AI' : 'YOUR COMMAND'}`;
  $('restart').textContent = demo ? 'WATCH AGAIN' : 'PLAY AGAIN';
  setHudInert(false);
  try {
    if (!renderer) renderer = new BattlefieldRenderer($('scene'), onSelect, cancelTraining, ejectGarrisoned, audio);
    renderer.reset();
    setSpeed(speedIndex);
    setView('map');
    $('pause').focus();
    audio.setWorld(true);
    audio.play('start');
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
  audio.setWorld(false);
  debugRecorder = null;
  debugReport = null;
  debugActions?.reset();
  game?.free();
  game = null;
  showcase = null;
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
  audio.setWorld(!paused);
  audio.play(paused ? 'pause' : 'resume');
  refresh();
  $(paused ? 'resume' : 'pause').focus();
}
function setMuted(value) {
  audio.setMuted(value);
  $('sound').setAttribute('aria-pressed', String(value));
  $('sound').title = `Sound ${value ? 'off' : 'on'}: click or press M to ${value ? 'unmute' : 'mute'}`;
  audio.play('click');
}

// Sidebar cameos follow the hotkey order; the anti-tank pads are static markup.
const cameoOrder = ['soldier', 'rocket', 'tank', 'collector', 'demolition'];
function createProduction() {
  const notes = {
    collector: ' — automatically mines ore and delivers credits to your refinery',
    demolition: ' — 6s build, 140 HP. Waits ahead of your line and strikes groups near it; Send it to hit the best target anywhere. Explodes when it strikes or is destroyed: up to 450 damage, radius 7, damages allies. One fielded or queued.',
  };
  const html = cameoOrder.map(kind => specs.find(s => s.kind === kind)).map(s => `<button type="button" class="cameo" id="train-${s.kind}" title="Queue ${s.name}, ${s.cost} credits (${s.key})${notes[s.kind] || ''}"><span class="cameo-icon cameo-art-${s.kind}" aria-hidden="true"></span><span class="cameo-progress" aria-hidden="true"></span><span class="cameo-key" aria-hidden="true">${s.key}</span><span class="cameo-name">${s.short}</span><small class="cameo-cost">${s.cost}</small><span class="cameo-badge" hidden></span>${s.kind === 'demolition' ? '<span id="demolition-status" class="cameo-flag">1×</span>' : ''}</button>`).join('');
  $('production').insertAdjacentHTML('afterbegin', html);
  for (const s of specs) $(`train-${s.kind}`).addEventListener('click', () => train(s.kind));
}
function cancelTraining(building, index) {
  if (!canCommand()) return;
  debugRecorder?.command('cancel_training', { building, index }, snapshot.time);
  game.cancel_training(building, index);
  refresh();
  audio.play('cancel');
}
function ejectGarrisoned(id) {
  if (!canCommand()) return;
  debugRecorder?.command('eject_garrisoned', { id }, snapshot.time);
  game.eject_garrisoned(id);
  refresh();
  audio.play('select');
}
function setMode(mode) {
  if (!canCommand()) return;
  if (mode === 'gather' && snapshot?.mode === 'gather') {
    const gathered = snapshot.units.filter(
      u => u.team === 'player' && u.state === 'gather' && u.kind !== 'collector' && u.kind !== 'demolition',
    );
    if (gathered.length > 0) {
      const healthy = gathered.filter(u => u.hp > u.max_hp * 0.5);
      const healthySelected = healthy.length > 0 && selected.size === healthy.length && healthy.every(u => selected.has(u.id));
      const allSelected = selected.size === gathered.length && gathered.every(u => selected.has(u.id));
      selected.clear();
      if (healthy.length > 0 && !healthySelected && !allSelected) {
        for (const u of healthy) selected.add(u.id);
      } else if (!allSelected) {
        for (const u of gathered) selected.add(u.id);
      }
      refresh();
      audio.play(selected.size ? 'select' : 'gather');
      return;
    }
  }
  debugRecorder?.command('set_mode', { mode }, snapshot.time);
  game.set_mode(mode);
  selected.clear();
  refresh();
  audio.play(mode);
}
function sendSelected() { if (!canCommand() || !selected.size) return; debugRecorder?.command('attack_selected', { ids: [...selected] }, snapshot.time); game.attack_selected(new Uint32Array([...selected])); selected.clear(); refresh(); audio.play('send'); }
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
  if (id !== null) audio.play('select');
  refresh();
}
function setText(element, text) { if (element.textContent !== text) element.textContent = text; }

// EVA-style status line: derived from snapshots only, it never affects the match.
const onlineGuns = new Set(), onlineStructures = new Set();
let lastUnitCount = null, statusTimer = 0;
function announce(message, sound) {
  const status = $('hud-status');
  status.textContent = message;
  status.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { status.hidden = true; }, 2200);
  audio.play(sound);
}
// Raise the alarm when one of our buildings is hit or lost, then stay quiet
// for a while: a base under siege is hit many times a second.
const ALARM_INTERVAL = 15000;
const buildingHealth = new Map(), unloading = new Set();
let lastAlarm = -Infinity;
function watchBase() {
  const buildings = snapshot.buildings.filter(b => b.team === 'player');
  const attacked = buildings.length < buildingHealth.size
    || buildings.some(b => b.hp < (buildingHealth.get(b.id) ?? b.hp));
  buildingHealth.clear();
  for (const b of buildings) buildingHealth.set(b.id, b.hp);
  if (attacked && performance.now() - lastAlarm > ALARM_INTERVAL) {
    lastAlarm = performance.now();
    announce('BASE UNDER ATTACK', 'alert');
  }
  // A collector that has finished unloading has just been paid.
  for (const unit of snapshot.units) {
    if (unit.team !== 'player' || unit.kind !== 'collector') continue;
    if (unit.unload_progress > 0) unloading.add(unit.id);
    else if (unloading.delete(unit.id)) audio.play('credit');
  }
}
function resetHud() {
  onlineGuns.clear();
  onlineStructures.clear();
  buildingHealth.clear();
  unloading.clear();
  lastAlarm = -Infinity;
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
  const refinery = snapshot.buildings.some(b => b.team === 'player' && b.kind === 'refinery' && finished(b));
  const refineryBuilding = snapshot.buildings.some(b => b.team === 'player' && b.kind === 'refinery' && !finished(b));
  const collectors = snapshot.units.filter(u => u.team === 'player' && u.kind === 'collector').length;
  const sheltered = snapshot.units.filter(u => u.team === 'player' && u.state === 'garrison').length;
  $('economy-status').textContent = `${collectors} COLLECTOR${collectors === 1 ? '' : 'S'} · REFINERY ${refinery ? 'ONLINE' : refineryBuilding ? 'BUILDING' : snapshot.game_mode === 'standard' ? 'NONE' : 'LOST'}${sheltered ? ` · ${sheltered} INSIDE` : ''}`;
  const demolitionQueued = snapshot.factory_queue.includes('demolition');
  const demolitionAlive = snapshot.units.some(u => u.team === 'player' && u.kind === 'demolition');
  setText($('demolition-status'), demolitionAlive ? 'ACTIVE' : demolitionQueued ? 'QUEUED' : '1×');
  for (const s of specs) {
    const building = ['tank', 'collector', 'demolition'].includes(s.kind) ? 'factory' : 'barracks';
    const queue = building === 'factory' ? snapshot.factory_queue : snapshot.barracks_queue;
    const producer = snapshot.buildings.find(b => b.team === 'player' && b.kind === building && finished(b));
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
  // The command center builds one site structure at a time; guns build on their own pads.
  const constructing = snapshot.buildings.find(b => b.team === 'player' && b.kind !== 'emplacement' && b.hp > 0 && b.construction_remaining > 0);
  for (const { kind, cost } of structures) {
    const structure = snapshot.buildings.find(b => b.team === 'player' && b.kind === kind && b.hp > 0);
    const button = $(`construct-${kind}`);
    const online = !!structure && structure.construction_remaining <= 0;
    const building = !!structure && !online;
    button.disabled = !canCommand() || !!structure || !!constructing || !command || snapshot.credits < cost;
    button.classList.toggle('online', online);
    button.classList.toggle('is-building', building);
    if (building) button.style.setProperty('--progress', Math.max(0, Math.min(1, 1 - structure.construction_remaining / structure.construction_time)));
    setText(button.querySelector('.cameo-cost'), online ? 'ONLINE' : building ? `${Math.ceil(structure.construction_remaining)}s` : command ? String(cost) : 'LOST');
    if (snapshot.game_mode === 'standard') {
      if (online && !onlineStructures.has(kind) && !demo && snapshot.time > 0) announce('CONSTRUCTION COMPLETE', 'complete');
      if (online) onlineStructures.add(kind); else onlineStructures.delete(kind);
    }
  }
  for (const slot of [0, 1]) {
    const gun = snapshot.buildings.find(b => b.team === 'player' && b.defense_slot === slot);
    const button = $(`defense-${slot}`);
    const online = !!gun && gun.construction_remaining <= 0;
    const building = !!gun && gun.construction_remaining > 0;
    button.disabled = !canCommand() || !!gun || !command || snapshot.credits < 200;
    button.classList.toggle('online', online);
    button.classList.toggle('is-building', building);
    if (building) button.style.setProperty('--progress', Math.max(0, Math.min(1, 1 - gun.construction_remaining / gun.construction_time)));
    setText(button.querySelector('.cameo-cost'), online ? 'ONLINE' : building ? `${Math.ceil(gun.construction_remaining)}s` : command ? '200' : 'LOST');
    if (online && !onlineGuns.has(slot) && !demo) announce('CONSTRUCTION COMPLETE', 'complete');
    if (online) onlineGuns.add(slot); else onlineGuns.delete(slot);
  }
  const playerUnits = snapshot.units.filter(u => u.team === 'player').length;
  if (lastUnitCount !== null && playerUnits > lastUnitCount && !demo) announce('UNIT READY', 'ready');
  lastUnitCount = playerUnits;
  if (!demo && snapshot.outcome === 'playing') watchBase();
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
    audio.play(victory || demo ? 'victory' : 'defeat');
    $('result-title').textContent = demo ? (victory ? 'BLUE WINS' : 'RED WINS') : (victory ? 'VICTORY' : 'DEFEAT');
    $('game-over').classList.remove('hidden');
    $('restart').focus();
  }
}
function beginDamageShowcase() {
  game?.free();
  game = null;
  demo = true;
  paused = false;
  ended = false;
  selected.clear();
  $('main-menu').hidden = true;
  $('app').hidden = false;
  $('app').classList.add('demo-mode');
  $('app').classList.remove('standard-mode');
  $('pause-screen').hidden = true;
  $('game-over').classList.add('hidden');
  $('spectator-note').hidden = false;
  $('match-label').textContent = 'DAMAGE SHOWCASE · CLOSE-UP';
  if (!renderer) renderer = new BattlefieldRenderer($('scene'), onSelect, cancelTraining, ejectGarrisoned, audio);
  renderer.reset();
  renderer.setView('map');
  renderer.zoom = .38;
  renderer.resize();
  const cols = [
    { x: -12, fraction: 1.0 },
    { x: -4, fraction: .70 },
    { x: 4, fraction: .45 },
    { x: 12, fraction: .20 },
  ];
  const unitRows = [
    { kind: 'tank', max_hp: 280, z: -10.5 },
    { kind: 'collector', max_hp: 220, z: -6.0 },
    { kind: 'demolition', max_hp: 140, z: -1.5 },
    { kind: 'soldier', max_hp: 100, z: 7.0 },
    { kind: 'rocket', max_hp: 80, z: 10.6 },
  ];
  let nextId = 1;
  const units = [], buildings = [], targets = [];
  for (const row of unitRows) {
    for (const col of cols) {
      const id = nextId++;
      const u = {
        id, team: 'player', kind: row.kind, state: 'gather',
        x: col.x - .18, z: row.z - .24, baseX: col.x, baseZ: row.z,
        hp: row.max_hp, max_hp: row.max_hp, cargo: row.kind === 'collector' ? 65 : 0,
        unload_progress: 0, targetFraction: col.fraction,
      };
      units.push(u);
      if (col.fraction < 1) targets.push({ item: u, isUnit: true });
    }
  }
  for (const col of cols) {
    const id = nextId++;
    const b = {
      id, team: 'player', kind: 'emplacement',
      x: col.x, z: 3.0, hp: 450, max_hp: 450,
      construction_time: 0, construction_remaining: 0, facing: -.55,
      targetFraction: col.fraction,
    };
    buildings.push(b);
    if (col.fraction < 1) targets.push({ item: b, isUnit: false });
  }
  showcase = {
    time: 0,
    turned: false,
    struck: false,
    nextShotId: 1,
    targets,
    snapshot: {
      time: 0,
      outcome: 'playing',
      mode: 'gather',
      game_mode: 'deathmatch',
      credits: 0,
      barracks_queue: [],
      factory_queue: [],
      defense_slots: [],
      sites: [],
      ore: [],
      buildings,
      units,
      shots: [],
      explosions: [],
    },
  };
  snapshot = showcase.snapshot;
  renderer.update(showcase.snapshot, selected);
}
function stepShowcase(dt) {
  showcase.time += dt;
  const snap = showcase.snapshot;
  snap.time = showcase.time;
  snap.shots = [];
  if (!showcase.turned && showcase.time >= .04) {
    showcase.turned = true;
    for (const u of snap.units) { u.x = u.baseX; u.z = u.baseZ; }
  }
  if (!showcase.struck && showcase.time >= .25) {
    showcase.struck = true;
    for (const { item, isUnit } of showcase.targets) {
      item.hp = item.max_hp * item.targetFraction;
      snap.shots.push({
        id: showcase.nextShotId++,
        source_id: 999,
        source_is_unit: true,
        target_id: item.id,
        target_is_unit: isUnit,
        kind: 'tank',
        x: item.x - 10,
        source_y: 1.5,
        z: item.z + 8,
        target_x: item.x,
        target_y: 1.2,
        target_z: item.z,
      });
    }
  }
  renderer.update(snap, selected);
}
function frame(now) {
  if (!lastTime) lastTime = now;
  const dt = Math.min((now - lastTime) / 1000, .1); lastTime = now;
  if (showcase) {
    stepShowcase(dt * SPEEDS[speedIndex]);
  } else if (game && !paused) {
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
for (const { kind } of structures) $(`construct-${kind}`).addEventListener('click', () => construct(kind));
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
$('sound').addEventListener('click', () => setMuted(!audio.muted));
setMuted(audio.muted);
// Controls without a sound of their own get a plain click.
document.addEventListener('click', event => {
  const control = event.target.closest('button, a');
  if (control && !control.matches('.cmd, .cameo, .queue-unit, #pause, #resume, #start-game, #start-demo, #restart, #sound')) audio.play('click');
});
window.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || !game) return;
  if (event.key.toLowerCase() === 'p' || (paused && event.key === 'Escape')) {
    event.preventDefault();
    setPaused(!paused);
    return;
  }
  if (event.key.toLowerCase() === 'm') { setMuted(!audio.muted); return; }
  if (paused) {
    if (event.key === 'Tab') {
      event.preventDefault();
      $(document.activeElement === $('resume') ? 'pause-abort' : 'resume').focus();
    }
    return;
  }
  if (event.key === '+' || event.key === '=') { setSpeed(speedIndex + 1); audio.play('click'); return; }
  if (event.key === '-' || event.key === '_') { setSpeed(speedIndex - 1); audio.play('click'); return; }
  if (!canCommand()) return;
  if (event.key === '1') setMode('gather');
  if (event.key === '2') setMode('attack');
  if (event.key.toLowerCase() === 'r') setMode('retreat');
  const spec = specs.find(s => s.key === event.key);
  if (spec) train(spec.kind);
  if (event.key === '8') buildEmplacement(0);
  if (event.key === '9') buildEmplacement(1);
  const structure = structures.find(s => s.key === event.key.toLowerCase());
  if (structure) construct(structure.kind);
  if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) sendSelected();
  if (event.key === 'Escape') { selected.clear(); refresh(); }
});
async function start() {
  try {
    // The asynchronous WASM fetch can reuse an old cached build even after a
    // page reload. Revalidate it so new renderer fields match the simulation.
    await init({ module_or_path: fetch(new URL('./pkg/lower_base_bg.wasm', import.meta.url), { cache: 'no-cache' }) });
    createProduction();
    $('start-game').disabled = false;
    $('start-demo').disabled = false;
    $('menu-status').textContent = 'READY FOR COMMAND';
    if (new URLSearchParams(location.search).get('showcase') === 'damage') beginDamageShowcase();
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    $('menu-status').textContent = 'Unable to load the game. Build the WebAssembly files and serve this page over HTTP; see the README.';
  }
}
start();
