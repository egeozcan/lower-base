// Run after building either mode: node --test scripts/test-debug-export.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import init, { GameBridge } from '../web/pkg/lower_base.js';
import { BUILD_INFO } from '../web/pkg/build_config.js';
import { MatchDebugRecorder } from '../web/match-debug.mjs';

await init({ module_or_path: await readFile(new URL('../web/pkg/lower_base_bg.wasm', import.meta.url)) });

test('production omits the internal API; local build explicitly enables it', () => {
  assert.equal(typeof GameBridge.prototype.debug_snapshot === 'function', BUILD_INFO.development);
  const game = GameBridge.with_difficulty(26, 'hard', false);
  try {
    const state = JSON.parse(game.snapshot());
    assert.equal(state.ai_credits, undefined);
    assert.equal(state.hard_commanders, undefined);
    if (BUILD_INFO.development) {
      const debug = JSON.parse(game.debug_snapshot());
      assert.deepEqual(debug.state, state);
      assert.equal(debug.internal.enemy_credits, 500);
      assert.equal(debug.internal.commanders.length, 2);
    }
  } finally { game.free(); }
});

test('recorder retains command arguments, samples lazily and freezes at the end', () => {
  const metadata = { seed: 26 };
  const recorder = new MatchDebugRecorder(metadata, { state: { time: 0 } });
  metadata.seed = 999;
  const ids = [1, 2];
  recorder.updated(.05);
  recorder.command('attack_selected', { ids }, .05);
  ids.length = 0;
  let reads = 0;
  const read = () => { reads++; return { state: { time: 2 } }; };
  recorder.observe({ time: 1 }, read);
  assert.equal(reads, 0);
  recorder.observe({ time: 2 }, read);
  recorder.observe({ time: 2 }, read);
  assert.equal(reads, 1);
  const report = recorder.finish({ state: { time: 3, outcome: 'victory' } });
  const exported = JSON.stringify(report);
  recorder.updated(.1);
  recorder.command('train', { kind: 'tank' }, 3);
  recorder.observe({ time: 100 }, read);
  recorder.finish({ state: { outcome: 'defeat' } });
  assert.equal(JSON.stringify(report), exported);
  assert.equal(report.metadata.seed, 26);
  assert.deepEqual(report.commands[0], { tick: 1, time: .05, action: 'attack_selected', args: { ids: [1, 2] } });
});

for (const demo of [false, true]) {
  test(`exported ${demo ? 'demo' : 'human'} match replays to the exact final state`, { skip: !BUILD_INFO.development }, () => {
    const game = GameBridge.with_difficulty(26, 'hard', demo);
    const replay = GameBridge.with_difficulty(26, 'hard', demo);
    const debug = () => JSON.parse(game.debug_snapshot());
    try {
      const recorder = new MatchDebugRecorder({ seed: 26, difficulty: 'hard', demo }, debug());
      const apply = (target, { action, args }) => {
        if (action === 'train') target.train(args.kind);
        else if (action === 'cancel_training') target.cancel_training(args.building, args.index);
        else if (action === 'eject_garrisoned') target.eject_garrisoned(args.id);
        else if (action === 'set_mode') target.set_mode(args.mode);
        else if (action === 'attack_selected') target.attack_selected(new Uint32Array(args.ids));
        else assert.fail(`unknown replay action: ${action}`);
      };
      const orders = new Map([
        [0, { action: 'train', args: { kind: 'collector' } }],
        [3, { action: 'train', args: { kind: 'rocket' } }],
        [4, { action: 'cancel_training', args: { building: 'barracks', index: 0 } }],
        [5, { action: 'attack_selected', args: { ids: debug().state.units.filter(u => u.team === 'player').slice(0, 2).map(u => u.id) } }],
        [10, { action: 'set_mode', args: { mode: 'retreat' } }],
        [200, { action: 'set_mode', args: { mode: 'gather' } }],
        [240, { action: 'set_mode', args: { mode: 'attack' } }],
      ]);
      let state = JSON.parse(game.snapshot());
      for (let tick = 0; tick < 20000 && state.outcome === 'playing'; tick++) {
        if (!demo && tick === 150) {
          const occupant = state.units.find(u => u.team === 'player' && u.state === 'garrison');
          assert.ok(occupant, 'ejection replay must exercise a completed garrisoned unit');
          orders.set(tick, { action: 'eject_garrisoned', args: { id: occupant.id } });
        }
        if (!demo && orders.has(tick)) {
          const order = orders.get(tick);
          recorder.command(order.action, order.args, state.time);
          apply(game, order);
        }
        const dt = [0, .016, .037, .1, .05][tick % 5];
        game.update(dt);
        recorder.updated(dt);
        state = JSON.parse(game.snapshot());
        recorder.observe(state, debug);
      }
      assert.notEqual(state.outcome, 'playing');
      const report = JSON.parse(JSON.stringify(recorder.finish(debug())));
      assert.ok(report.checkpoints.length > 2);
      assert.deepEqual(report.checkpoints[0].snapshot, JSON.parse(replay.debug_snapshot()));
      let command = 0;
      for (let tick = 0; tick < report.updates.length; tick++) {
        while (report.commands[command]?.tick === tick) apply(replay, report.commands[command++]);
        replay.update(report.updates[tick]);
      }
      assert.equal(command, report.commands.length);
      assert.deepEqual(JSON.parse(replay.debug_snapshot()), report.final_state);
    } finally { game.free(); replay.free(); }
  });
}
