# Lower Base

A fast-paced, single-player real-time strategy prototype. Hold the southern base, build an army, and destroy every enemy unit and structure. The simulation runs in Rust compiled to WebAssembly; the battlefield is rendered in 3D in the browser.

## Run locally

Install [Rust](https://www.rust-lang.org/tools/install), Python 3, and the WebAssembly build tools (once):

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
```

Build and serve the game:

```sh
./scripts/build-web.sh
python3 -m http.server 8000 --directory web
```

Open <http://localhost:8000>. Serve the files over HTTP rather than opening `index.html` directly, so the browser can load the WebAssembly module. The 3D renderer is included locally.

## How to play

The main menu offers **Easy**, **Medium** (default), and **Hard** AI difficulty, followed by **Start Game**, **Demo**, and **Help**. Start Game puts you in command of the southern blue army. Demo lets you spectate two computer commanders at the selected difficulty; troop commands are disabled. Help opens the field manual with objectives, unit guidance, and controls.

- **Easy** reacts slowly, uses a predictable army mix, and sends small patrols with long gaps. A forgiving opponent for learning the game.
- **Medium** uses the original adaptive production, regular attack waves, and defensive regrouping strategy.
- **Hard** switches between pressure, economic expansion, anti-armor, anti-infantry, defense, and finishing plans as battlefield conditions change. It weighs both damage and survivability when building counters, holds unfavorable engagements, reinforces successful pushes, and releases sheltered defenders when the base is breached. Against opening rushes it holds the firing line and restores mining income before a decisive counterattack. It can build and immediately send a demolition truck against an unopposed wave when the blast can be delivered safely. Each match varies its opening, risk tolerance, plan duration, production ties, and assault timing; the same seed remains reproducible.

At equal spending, **rifles beat rocket troopers, rockets beat tanks, and tanks
beat rifles**. Rocket hits deal 78 damage to tanks; tank shells deal 18 damage to
rocket troopers and 34 to rifles. Damage to buildings and demolition-truck targets
is unchanged. Keep the units that counter the enemy force protected by a mixed army.

All difficulties play fairly: both sides start with 500 credits, earn 24 passive credits per second, and have a 2,000-credit cap. Unit costs, build times, movement, combat, mining, and queue limits are identical. The whole battlefield is visible to both sides; AI decisions cannot inspect opposing production queues or sheltered units. Difficulty changes the commander's decisions, never its resources or unit stats. The selected difficulty applies to demos and rematches too.

During either a game or demo, **Pause** (or `P`) freezes the battlefield, production, and income. Choose **Resume**, press `P`, or press `Esc` to continue. **Abort** returns to the main menu; your next match starts fresh. Finished demos announce the winning color and offer **Watch Again** or **Main Menu**.

- Queue rifle infantry and rocket troopers at the barracks, and tanks, demolition trucks, or ore collectors at the factory. Credits replenish over time; collectors bring in additional income.
- **Demolition Truck** costs 250 credits and takes 6 seconds at the factory. Only one may be alive or queued per side; its slot opens after it explodes. It has 140 HP, moves slightly faster than a tank, and detonates at close range or when destroyed. The blast deals 450 damage within 2 units, falling linearly to zero at radius 7. It damages **all units and buildings, including allies**, and can trigger other trucks. Building damage uses the nearest edge of the footprint. Send it separately from your troops: rockets can stop it at range, tanks survive near the outer edge of the blast, and a full-health building survives even a direct blast. The AI occasionally fields one against large infantry armies and builds extra rockets against yours.
- Both sides start with a refinery. Ore fields are randomly generated each match with equal amounts and positions rotated 180 degrees between the bases. Build an **Ore Collector** for 200 credits; it automatically mines ore and delivers up to 100 credits per trip to your refinery. Ore depletes as it is mined, and collectors move on to the next field.
- Collectors are unarmed and mine independently once deployed. Collectors completed during Retreat wait inside the factory until Gather or Attack releases them. Protect them and your refinery to keep ore income flowing. The opposing commander also builds collectors.
- Click a gathered unit to select it; Shift-click to add or remove units. On touchscreens, tap units to toggle their selection. Tap empty ground to clear it. Use **Send** to commit the selected units.
- Use **Base** to zoom into your rally area for easier selection and **Map** to see the full battlefield.
- Keyboard shortcuts: `1` Gather, `2` Attack, `R` Retreat, `3` rifle infantry, `4` rocket trooper, `5` tank, `6` ore collector, `7` demolition truck, `Enter` send selected, `Esc` clear selection.
- **Gather** keeps newly produced troops in front of your base. Select gathered units individually or as a group and send only those troops north.
- **Attack** sends all gathered troops north and automatically sends newly produced troops into battle. Use **Retreat** to recall attacking troops.
- **Retreat** recalls deployed troops to the base rally area and keeps all newly completed units inside their barracks or factory. Recalled troops defend locally once they reach the rally area; active collectors keep mining. Choose **Gather** to release sheltered troops to the rally area, or **Attack** to release them into battle. Sheltered collectors resume mining in either mode. Units inside a building are lost if it is destroyed.
- Eliminate all enemy units and buildings to win. You lose when all your units and buildings are destroyed.

The opposing commander adjusts its production to your army, retreats when an incoming force overwhelms its local defenders, and releases reserves once it has regrouped or the threat passes. There is no building placement in this version.

## Development

The Rust game simulation lives in `src/simulation.rs`, with a small WebAssembly bridge in `src/lib.rs`. The browser UI and renderer live in `web/`. Run `cargo test` for the simulation tests; rebuild the WebAssembly module after changing Rust code.


## Local match debug exports

`./scripts/build-web.sh` (or `--dev`) enables local debug recording. After a game
or demo ends, **Download Debug Data** and **Copy Debug Data** appear alongside
Play Again/Watch Again and Main Menu. Both export the same JSON report. If the
browser denies clipboard access, a selected text area lets you copy manually.
Export before starting another match or returning to the menu; recordings stay
in browser memory and are cleared with the match.

Reports include the seed, difficulty, demo flag, build revision and source hash,
browser/viewport, player command order, every simulation update duration, snapshots
every two simulated seconds, the final battlefield, both commanders' plans and
random state, enemy resources and production queues. They contain no network
uploads. Commands at tick `n` run before `updates[n]`; replay from the seed with
the same game sources and recorded timing. Export/replay checks run against the
actual built WebAssembly module:

```sh
./scripts/build-web.sh
node --test scripts/test-debug-export.mjs
# Verify an unchanged build against an export, or test a counter-strategy change.
node scripts/replay-debug.mjs path/to/debug.json --verify
node scripts/replay-debug.mjs path/to/debug.json --expect-ai-win
```

`./scripts/build-web.sh --production` disables recording, omits the internal-state
WebAssembly API, and creates no export controls. The GitHub Pages workflow always
uses this production mode. The build-mode configuration is generated inside the
ignored `web/pkg/` directory, so local settings cannot be accidentally committed
into the published game.

## AI simulation benchmark

The native tournament harness runs Hard against frozen stock Hard and scripted
player strategies. The stock implementation comes from commit `91110ae`. The stock force estimator is
preserved too, so future scoring changes cannot silently strengthen the baseline.
Neither the frozen opponent nor the harness is included in normal WebAssembly builds.

```sh
# 12 seeds, both starting sides, standard starts (24 games).
cargo run --release --features ai-bench --bin ai-bench

# seed count, first seed, game time limit in seconds, scenario set.
cargo run --release --features ai-bench --bin ai-bench -- 64 10000 360 stock > results.json

# Target a single scenario family.
cargo run --release --features ai-bench --bin ai-bench -- 16 0 360 rush
cargo run --release --features ai-bench --bin ai-bench -- 64 10000 360 balanced
cargo run --release --features ai-bench --bin ai-bench -- 16 0 360 player-armor

# Compare paired reports and fail if rush wins do not improve or any balanced
# match differs (including duration, surviving material and plan selections).
python3 scripts/compare-ai-bench.py before.json after.json \
  --require-balanced-identical --require-rush-improvement

# Optional per-side army, economy, queue and strategy traces go to stderr.
AI_BENCH_TRACE=1 cargo run --release --features ai-bench --bin ai-bench -- 1 26 180 all
```

JSON on stdout records every seed, side, scenario, actual win/loss or timeout,
match duration, surviving army value and plan selections. The plan counters are
ordered: pressure, economy, anti-armor, anti-infantry, defend, finish. Progress and
traces use stderr. Timeouts count as draws, regardless of remaining material.
Both commanders decide every 0.5 simulated seconds and share the real production,
mining, movement, damage, and 0.05-second physics steps. Every map is played with
the upgraded commander on each side.

`stock` includes the standard opening, three tanks plus a soldier per side, ten
soldiers per side, scarce ore (120 credits per deposit), and an early-rush stress
test. The first four have balanced starting conditions. In the rush test stock
Hard's original army starts already attacking across midfield, giving it a
positional advantage; its units and resources are unchanged.

`player-armor` runs the full 32-order player recording, its minimized 14-order
tank-only version, a second 22-order recording with a later attack, and four
automated tank strategies (early attack, retreat/rebuild, late attack, and a
four-collector economy). The
recordings use command times from a player-provided debug export, sampled every
0.05 seconds. The automated player attacks at 32 seconds, retreats at 48, gathers
at 51, and attacks again at 67, continuously producing tanks when affordable.
All player profiles use ordinary orders and production rules. `interception`
starts Hard with no combat troops against an advancing eight-rifle wave, to
exercise emergency demolition decisions. `all` runs all thirteen scenarios. The legacy `stock_surviving_value` JSON field records the
opponent's surviving value, including for scripted player scenarios.

### Earlier rush-defense validation

Rush-defense development compared recovery windows of 12, 18, 24 and 30 seconds
after observing opening pressure. Across seeds 0–15 and both sides, these won
32/32, 10/32, 23/32 and 30/32 rush games respectively. A shorter recovery preserves
the firing line and funds miners without giving the opponent too much rebuilding
time. The selected 12-second window then won 64/64 rush games on seeds
10000–10031. These seeds were development/verification data, not the final holdout.

The final paired validation used **64 fresh seeds (20000–20063), five scenarios
and both sides: 640 games per version**, with a six-minute limit. Both the
pre-rush-defense commander and the final commander faced the same frozen stock
Hard opponent. The final commander won **620/640 (96.9%)**, with 20 losses and
no timeouts:

| Starting condition | Before wins | After wins | After win rate |
| --- | ---: | ---: | ---: |
| Standard | 124/128 | 124/128 | 96.9% |
| Armor-heavy | 120/128 | 120/128 | 93.8% |
| Infantry-heavy | 127/128 | 127/128 | 99.2% |
| Scarce ore | 121/128 | 121/128 | 94.5% |
| Advanced-position rush | 80/128 | 128/128 | 100.0% |

Rush wins increased from **62.5% to 100.0%**, gaining 48 wins and losing none.
Every balanced match in this paired tournament was identical before and after,
including time, surviving material and strategy counters: **492/512 wins (96.1%)**
in each version. Rerunning the previous 512 balanced games (seeds 10000–10063)
also reproduced every match exactly, retaining **489/512 wins (95.5%)**. Together
that is **1,024 unchanged balanced matches**.

That version's opening recovery reacted only to visible combat pressure during the first eight
seconds. It held gathered forces for up to twelve seconds after that observation,
but never holds the last army after its production buildings are lost. Collectors
are permitted against safely outmatched infantry survivors; incoming armor or
trucks still take priority. Regular openings retain the same decisions and random
streams. This explains why the balanced comparisons can be identical rather than
merely retaining a similar aggregate win rate.

The reports for this run are in `output/ai-rush-fresh-before.json`,
`output/ai-rush-fresh-after.json`, `output/ai-rush-fresh-comparison.json` and
`output/ai-rush-balanced-comparison.json` (local, ignored output artifacts). The
pre-change source snapshot and executable are retained locally in
`output/ai-before-rush.rs` and `output/ai-bench-before-rush`.

These are comparisons against this stock commander, not evidence of equivalent
performance against every human strategy. Regression tests cover stock rush
matchups, condition-driven recovery and counters, economic safety, bounded
counterattack delays, loss of production, ordinary openings, lower difficulties,
private-information boundaries, resource fairness and reproducible variation.


### Armor formation regression before counter rebalancing

A player export exposed a formation problem: rockets move faster than tanks but
have shorter range and much less health. Releasing the whole army at once put
rockets ahead of their tank screen, where concentrated armor killed them before
the rest of the wave arrived. The original export replayed exactly to a human
victory at 125.98 seconds. Removing collectors, retreats and rocket purchases
still left 14 tank-only orders that won. Reducing rocket production alone failed
to resolve the replay.

Hard now staggers rocket-heavy waves against visible massed armor. Tanks depart
first; rockets are released when their estimated arrival lets the armored screen
make contact first. In-range defenders fire immediately, and an army without a
viable tank screen can still deploy. Regular mixed assaults use the existing wave
logic. The formation rule uses visible positions, unit speeds and ranges. That change
left unit stats, resources, movement, targeting and damage unchanged; the later
shared counter rebalance is described below.

The exact browser-frame replay is checked with `scripts/replay-debug.mjs`; the
native benchmark adds the full/minimal recording and automated tank strategy
across seeds and both starting sides. Regression tests also cover arrival order,
missing screens, immediate combat and hidden garrisons. Local comparison reports
and development probes are saved under `output/armor-strategy/`.


Final formation validation used **64 new holdout seeds (40000–40063), eight
scenarios, and both sides: 1,024 games per version**, separate from development
and verification seeds. The before/after commanders both faced frozen stock Hard
or the same scripted player orders; these are AI wins:

| Opponent/scenario | Before | After |
| --- | ---: | ---: |
| Stock standard | 124/128 | 124/128 |
| Stock armor-heavy | 113/128 | 113/128 |
| Stock infantry-heavy | 127/128 | 127/128 |
| Stock scarce ore | 124/128 | 124/128 |
| Stock advanced-position rush | 126/128 | 126/128 |
| Full player recording | 81/128 | 128/128 |
| Minimized tank-only recording | 114/128 | 128/128 |
| Continuous tank production | 20/128 | 70/128 |

Every stock match retained its original outcome: **488/512 balanced wins** and
**126/128 rush wins** in both versions. The three scripted player scenarios rose
from **215/384 to 326/384 wins**, with no timeouts in either tournament. Continuous
tank production remains a harder matchup; this change does not establish that
Hard can beat every adaptive human armor strategy.

The original high-frame-rate browser recording is also an exact regression case:
the old AI lost at **125.98 seconds**; the final AI wins at **76.51 seconds** using
the same player commands and frame durations. No replay or seed identifiers are
consulted by the commander. To repeat the holdout and gate the comparison:

```sh
cargo run --release --features ai-bench --bin ai-bench -- 64 40000 360 all > after.json
python3 scripts/compare-ai-bench.py before.json after.json \
  --require-stock-outcomes-identical --require-player-armor-improvement
```

Local before/after reports are `output/armor-strategy/final-heldout-before.json`
and `output/armor-strategy/final-heldout-after.json`; the paired summary is
`output/armor-strategy/final-comparison.json`. The pre-change commander and runner
are retained in that local output directory. These files are ignored artifacts.


### Current counter balance and demolition interceptions

Two player recordings exposed both formation problems and an insufficiently
strong anti-tank counter. Pure rockets could narrowly beat equal-credit tanks,
but retained only 18.6% of their value on average. The revised shared damage
matrix makes the counter cycle decisive:

| Attacker | Rifle target | Rocket target | Tank target |
| --- | ---: | ---: | ---: |
| Rifle | 12 | 19 | 5 |
| Rocket | 13 | 13 | **78** (was 52) |
| Tank | 34 | **18** (was 34) | 28 |

Costs, health, ranges, speed, reload times, income and building damage are
unchanged. Rocket damage to collectors and demolition trucks remains 52. These
values apply to human and computer units at every difficulty.

`cargo run --release --features ai-bench --bin ai-bench -- --balance` runs 72
real combat simulations at equal credit budgets: three army sizes, both starting
sides, close and distant starts, and aligned/offset formations. No AI production,
mining or buildings influence these tests:

| Equal-credit counter | Wins | Average surviving army value |
| --- | ---: | ---: |
| Rifles against rockets | 24/24 | 81.5% |
| Rockets against tanks | 24/24 | 69.2% |
| Tanks against rifles | 24/24 | 70.7% |

Hard also estimates demolition interceptions from visible enemy clusters, its
own factory queue, available credits, build time and closing speed. It avoids
blasts near friendly buildings, insufficient blast value, friendly coverage, and
long-range armies that can destroy the truck in one volley. A completed truck is
released through normal Gather/Attack orders, without waiting for the regular
wave timer or remaining sheltered. Money, production time and the one-truck limit
still apply. Regression battles verify an actual detonation, elimination of the
incoming wave, and no base damage, on both sides.

Rush recovery was recalibrated for the stronger counters. After an opening rush,
Hard rebuilds a consolidated firing line and mining income, rather than feeding
small counterattacks into enemy rifle screens. It can leave recovery early after
20 seconds when two collectors are active, local pressure has passed, and its
estimated advantage exceeds 1.8; the recovery window is bounded at 50 seconds
after the opening observation.

The latest paired tournament used seeds **60000–60031**, both sides, and thirteen
scenarios: **832 games per commander**. Both commanders used the **new shared
damage matrix**, so this comparison measures the AI changes without giving one
side different unit rules. The control was the previous Hard policy without
interceptions or recalibrated recovery:

| Scenario family | Control wins | Current wins |
| --- | ---: | ---: |
| Four balanced stock scenarios | 164/256 | 164/256 |
| Advanced-position rush | 37/64 | 62/64 |
| Seven recorded/automated tank strategies | 448/448 | 448/448 |
| No-army, unopposed-wave full matches | 0/64 | 0/64 |

The unopposed-wave stress case intentionally grants the opponent eight combat
units while Hard starts with none. Hard built and detonated an interceptor in
**64/64** current-policy games; the control built none. This validates the
interception behavior, not a guaranteed full-game recovery from that disadvantage.
No tournament games timed out. Both exact browser-frame recordings now end in AI
wins: **47.76 seconds** for the later attack and **53.25 seconds** for the first
recording. The seven armor profiles all won across the heldout maps and sides.

Current reports are under `output/armor-strategy-2/`, including
`balance-before.json`, `balance-after.json`, `heldout-before.json`,
`heldout-after.json`, and `comparison.json`. The native baseline executable there
uses the same new unit balance. Run `ai-bench --help` for all scenario selectors.
