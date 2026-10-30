// Replays local debug exports against the current development WebAssembly build.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { GameBridge } from '../web/pkg/lower_base.js';

const [path, ...options] = process.argv.slice(2);
if (!path || options.some(option => !['--verify', '--expect-ai-win'].includes(option))) {
  throw new Error('Usage: node scripts/replay-debug.mjs REPORT.json [--verify] [--expect-ai-win]');
}
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.schema_version, 1);
await init({ module_or_path: await readFile(new URL('../web/pkg/lower_base_bg.wasm', import.meta.url)) });
const { seed, difficulty, demo } = report.metadata;
const game = GameBridge.with_difficulty(seed, difficulty, demo);
try {
  let nextCommand = 0;
  for (let tick = 0; tick < report.updates.length; tick++) {
    while (report.commands[nextCommand]?.tick === tick) {
      const { action, args } = report.commands[nextCommand++];
      if (action === 'train') game.train(args.kind);
      else if (action === 'build_emplacement') game.build_emplacement(args.slot);
      else if (action === 'cancel_training') game.cancel_training(args.building, args.index);
      else if (action === 'eject_garrisoned') game.eject_garrisoned(args.id);
      else if (action === 'set_mode') game.set_mode(args.mode);
      else if (action === 'attack_selected') game.attack_selected(new Uint32Array(args.ids));
      else throw new Error(`Unknown command: ${action}`);
    }
    game.update(report.updates[tick]);
  }
  // A changed AI may need more time than the original recording to finish.
  if (options.includes('--expect-ai-win')) {
    for (let tick = 0; tick < 1200 && JSON.parse(game.snapshot()).outcome === 'playing'; tick++) game.update(.25);
  }
  const final = JSON.parse(game.debug_snapshot());
  console.log(JSON.stringify({ seed, outcome: final.state.outcome, seconds: final.state.time,
    player_units: final.state.units.filter(u => u.team === 'player').length,
    enemy_units: final.state.units.filter(u => u.team === 'enemy').length }));
  if (options.includes('--verify')) assert.deepEqual(final, report.final_state);
  if (options.includes('--expect-ai-win')) assert.equal(final.state.outcome, 'defeat', 'AI should beat the recorded strategy');
} finally { game.free(); }
