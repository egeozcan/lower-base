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

The main menu offers two game modes, **Deathmatch** (default) and **Standard**, then **Easy**, **Medium** (default), and **Hard** AI difficulty, followed by **Start Game**, **Demo**, and **Help**. Start Game puts you in command of the southern blue army. Demo lets you spectate two computer commanders at the selected difficulty; troop commands are disabled. Help opens the field manual with objectives, unit guidance, and controls.

- **Easy** reacts slowly, uses a predictable army mix, and sends small patrols with long gaps. A forgiving opponent for learning the game.
- **Medium** uses the original adaptive production, regular attack waves, and defensive regrouping strategy.
- **Hard** switches between pressure, economic expansion, anti-armor, anti-infantry, defense, and finishing plans as battlefield conditions change. It weighs both damage and survivability when building counters, holds unfavorable engagements unless longer-ranged attackers are picking off its defensive line, reinforces successful pushes, and releases sheltered defenders when the base is breached. Against opening rushes it holds the firing line and restores mining income before a decisive counterattack. It answers a massed rifle army that has no tanks and few rockets with a demolition truck, sends trucks on their own only for strikes worth more than their price, and can build and immediately send one against an unopposed wave when the blast can be delivered safely. Each match varies its opening, risk tolerance, plan duration, production ties, and assault timing; the same seed remains reproducible.

At equal spending, **rifles beat rocket troopers, rockets beat tanks, and tanks
beat rifles**. Rocket hits deal 78 damage to tanks; tank shells deal 18 damage to
rocket troopers and 34 to rifles. Damage to buildings is unchanged. Keep the units
that counter the enemy force protected by a mixed army.

### Game modes

- **Deathmatch** starts each side with its whole base (command center, barracks, factory, refinery), three rifles and a tank, and 500 credits. Each side earns 24 passive credits per second. Guns are the only structures you can construct.
- **Standard** starts each side with only its command center, no units, and 1,500 credits. Each side earns 5 passive credits per second. The command center constructs the **Refinery** (600 credits, 20 s), **Barracks** (400, 15 s), and **Factory** (800, 25 s) on fixed, marked sites in the usual base layout. Use the build buttons or `G` / `B` / `F`.
  - It builds one structure at a time, paid up front, with no queue and no cancel. Guns still build independently on their pads.
  - Structures appear at full health and can be attacked while under construction, but produce nothing and accept no ore until finished.
  - Every finished refinery, including a rebuilt one, comes with one ore collector that starts mining immediately. More collectors come from the factory while a refinery stands (in both modes).
  - Destroyed structures can be rebuilt for full cost while the command center stands. Without it, surviving buildings keep producing, but nothing new can be constructed. Empty sites do not count toward victory.
  - Every difficulty builds refinery, barracks, then factory, rebuilds losses in the same order, and holds back the next structure's price from other spending. Otherwise it plays as in Deathmatch.

All difficulties play fairly: both sides start with the same credits and passive income for the chosen mode, and have a 2,000-credit cap. Unit costs, build times, movement, combat, mining, and queue limits are identical. The whole battlefield is visible to both sides; AI decisions cannot inspect opposing production queues or sheltered units. Difficulty changes the commander's decisions, never its resources or unit stats. The selected difficulty applies to demos and rematches too.

During either a game or demo, **Pause** (or `P`) freezes the battlefield, production, and income. Choose **Resume**, press `P`, or press `Esc` to continue. **Abort** returns to the main menu; your next match starts fresh. Finished demos announce the winning color and offer **Watch Again** or **Main Menu**.

- Queue rifle infantry and rocket troopers at the barracks, and tanks, demolition trucks, or ore collectors at the factory. Credits replenish over time; collectors bring in additional income.
- **Anti-tank defenses:** each base has two fixed pads, left and right, marked by rings ahead of the production buildings. Use the defense buttons or `8` / `9` to build a gun for **200 credits**. Construction takes **8 seconds**, independently of unit queues; the gun is vulnerable and cannot fire while building. Completed guns have **450 HP**, range **22**, and fire every **1.6 seconds** for **100 damage against tanks**, 50 against trucks/collectors, and **34 against infantry and rockets**. Shells also splash other infantry and rocket troops within 2.5 units of the target for half damage. They prioritize armor and turn at a bounded speed. Their range covers the approach before infantry or armor can fire back. Rifle infantry deal double their usual building damage against these guns, so protect them with troops. Destroyed guns can be rebuilt for full cost while your command center stands. Empty pads do not count toward victory. Both sides use identical rules; Medium and Hard buy guns for visible armored attacks, but not against rifle-dominated ones. Medium gathers larger waves and more rifles against a gun-defended base.
- Each producing building has **9 shared slots for queued and garrisoned units**, shown above it in a 3×3 grid of rounded unit icons. Garrisoned units have blue backgrounds and a check mark; click one to eject it and free its slot. Ejected combat units gather at the rally area during Retreat, while collectors begin mining. Click a queued unit to cancel it and refund its cost (up to the credit cap). Canceling the active unit resets production progress; canceling a waiting unit preserves it.
- **Demolition Truck** costs 250 credits and takes 6 seconds at the factory. Only one may be alive or queued per side; its slot opens after it explodes. It has 140 HP, moves slightly faster than a tank, and explodes when it strikes or is destroyed. The blast deals 450 damage within 2 units, falling linearly to zero at radius 7. It damages **all units and buildings, including allies**, and can trigger other trucks. Building damage uses the nearest edge of the footprint; a full-health building survives even a direct blast.
  - A waiting truck parks on its own post, 8 units in front of your rally area and beyond blast reach of the troops there. It strikes enemies that come within 13 units of the post when the blast is worth at least its price, or for less once it comes under fire.
  - **Send** it to strike anywhere. It drives at the target where a blast would destroy the most credits, allowing for the fire it would take on the way in, and goes off once it has all it can get there, such as when the target's escorts block its way. It passes lone units for groups, finishes damaged buildings rather than chipping healthy ones, and destroys anti-tank guns outright. It never sets itself off where it would destroy more of your own side than of the enemy's, but a truck destroyed by enemy fire explodes where it is.
  - Rifles fire too late to stop a charging truck. Rocket hits deal 30 damage to it, so it takes the first volley of five rockets, or of rockets and tanks together, to destroy it before it closes. Tanks survive near the outer edge of the blast.
  - Medium occasionally fields one against large infantry armies. Hard fields one as soon as it sees a massed rifle army with no tanks and few rockets. Both send trucks on their own, never with an attack wave, and build extra rockets against yours.
- In Deathmatch, both sides start with a refinery. Ore fields are randomly generated each match with equal amounts and positions mirrored between the bases, so both sides face exactly the same map. Build an **Ore Collector** for 200 credits; it automatically mines ore and delivers up to 100 credits per trip to your refinery. Ore depletes as it is mined, and collectors move on to the next field.
- Ore visibly builds up in each collector's rear hopper as it mines. At the refinery, collectors stop for two seconds to turn, tip the hopper, and pour the load into the intake before driving off. Credits arrive when unloading finishes.
- Collectors are unarmed and mine independently once deployed. Each works one ore field until it runs out, chosen by driving distance to the refinery. Collectors spread across both flanks of the base so they do not meet head-on in the narrow gaps beside the factory and barracks. A collector whose field runs out mid-load fills up at another field when that is worth the detour. Collectors completed during Retreat wait inside the factory until Gather or Attack releases them. Protect them and your refinery to keep ore income flowing. The opposing commander also builds collectors.
- Click a gathered unit to select it; Shift-click to add or remove units. On touchscreens, tap units to toggle their selection. Tap empty ground to clear it. Use **Send** to commit the selected units.
- Use **Base** to zoom into your rally area for easier selection and **Map** to see the full battlefield.
- Keyboard shortcuts: `1` Gather, `2` Attack, `R` Retreat, `3` rifle infantry, `4` rocket trooper, `5` tank, `6` ore collector, `7` demolition truck, `Enter` send selected, `Esc` clear selection.
- **Gather** keeps newly produced troops in front of your base. Select gathered units individually or as a group and send only those troops north.
- **Attack** sends all gathered troops north and automatically sends newly produced troops into battle. Use **Retreat** to recall attacking troops.
- **Retreat** recalls deployed troops to the base rally area and keeps all newly completed units inside their barracks or factory. Recalled troops defend locally once they reach the rally area; active collectors keep mining. Choose **Gather** to release sheltered troops to the rally area, or **Attack** to release them into battle. Sheltered collectors resume mining in either mode. Units inside a building are lost if it is destroyed.
- Eliminate all enemy units and buildings to win. You lose when all your units and buildings are destroyed.

The opposing commander adjusts its production to your army, retreats when an incoming force overwhelms its local defenders, and releases reserves once it has regrouped or the threat passes. Structures are constructed only on their fixed sites; there is no free building placement.

## Development

The Rust game simulation lives in `src/simulation.rs`, with a small WebAssembly bridge in `src/lib.rs`. The browser UI and renderer live in `web/`. Run `cargo test` for the simulation tests; rebuild the WebAssembly module after changing Rust code.

## Unit navigation

Movement lives in `src/navigation.rs` and works in two layers:

- **Routes** go around buildings only. They are shortest paths that bend at
  building corners, so other units never close a route. A unit pushed into
  a gap narrower than itself first moves to the nearest open point.
- **Steering** picks each step's velocity from where nearby allies are heading,
  not just where they stand. Followers keep pace behind a leader instead of
  detouring around it. Allies meeting head-on both turn the same way, mirrored
  between the two bases so both teams behave alike. Opposing units are
  treated as stationary obstacles because they stop to fight at range.

When two allies cannot both pass, right of way decides. Loaded collectors go
first, then attacking troops, empty collectors, regrouping troops, and finally
units settling into their place. Among equals travelling together, the unit
behind gives way. A unit giving way steps out of the other's lane, or backs
out of a one-lane gap such as the one beside the factory. Parked units step
aside for passing allies and then return. A unit blocked for half a second
routes around stationary units, and after a second it pushes idle allies aside.
Destinations that another unit occupies fall back to the nearest free spot
within reach, so collectors mine from the free side of a deposit and attackers
spread along their firing range.

Collectors plan their work in `harvest_and_unload` and `choose_deposit` in
`src/simulation.rs`. Each collector keeps one deposit until it runs out, and
reconsiders only after a delivery, so it never changes its mind mid-trip. A
deposit is scored by the drive to it and on to the refinery by road, plus an
allowance for each other collector working it and a larger one for each ally on
the same flank. Same-flank collectors share the one-lane gap beside the factory or
barracks and must stop for each other there. A deposit that others will
nearly empty first counts as a smaller load. A collector whose deposit runs out
mid-load fills up at another one when the detour is shorter than the unused
share of a round trip.

`cargo run --release --features ai-bench --bin ai-bench -- --traffic` measures
collector deliveries over 180 seconds on eight ore layouts (collectors released
one build time apart, beside each side's idle starting army). It also measures
groups of four and eight units crossing head-on, filing around the factory, and
passing in opposite directions through the base. Deliveries per collector
(fewest by any collector in parentheses), compared with the previous grid
search, which treated every other unit as a wall, and with the new navigation
before collectors planned their deposits:

| Collectors per side | Grid search | New navigation | With deposit planning |
| ---: | ---: | ---: | ---: |
| 1 | 14.06 (13) | 14.00 (13) | 13.94 (13) |
| 2 | 13.50 (13) | 13.25 (11) | 13.78 (13) |
| 3 | 10.79 (9) | 11.81 (10) | 12.25 (11) |
| 4 | 9.27 (7) | 10.73 (9) | 11.31 (10) |
| 6 | 7.32 (4) | 8.97 (5) | 9.42 (8) |

On sixteen other layouts (seeds 100–115), ore delivered per collector went from
1369, 1304, 1028, 895 and 710 with the grid search to 1362, 1348, 1217, 1133
and 939 for one, two, three, four and six collectors per side. A lone collector
does slightly worse because it picks its deposit for the first load rather than
for the whole run.

| Group movement | Before | After |
| --- | ---: | ---: |
| Eight soldiers through the base, both directions | 11.2 s | 6.6 s |
| Four / eight tanks filing around the factory | 18.6 / 37.2 s | 7.9 / 13.1 s |
| Four / eight tanks through the base, both directions | 23.0 / 25.4 s | 9.5 / 14.7 s |
| Four / eight tanks crossing head-on in the open | 5.7 / 6.2 s | 6.5 / 7.6 s |

Head-on tank lines are slightly slower: a line of four tanks leaves no gap,
so the oncoming tanks must steer around its ends. Native AI tournaments now
run about six times faster (160 games: 4.5 s instead of 28 s). The demolition
interception test now allows 24 rather than 20 seconds for defenders to finish
the blast survivors; the previous navigation passed with about 0.4 seconds to
spare.

Deposit planning makes extra collectors much more productive, which favored
frozen stock Hard: it builds three collectors where Hard built one or two, and
its collector income in tournaments rose by about 15%. Hard's economy was
retuned to match. Collectors share the factory with tanks, Hard's counter to massed
infantry, so Hard now targets two collectors before 25 seconds and three later
unless it is countering infantry (then one, and later two). It keeps one
collector while recovering from an opening rush, which in practice leaves the
early exit from recovery unused. Wins against frozen stock Hard:

| Set | Grid search | New navigation | With deposit planning and retuned Hard |
| --- | ---: | ---: | ---: |
| Stock scenarios, seeds 0–31 | 237/320 | 243/320 | 244/320 |
| Stock scenarios, seeds 32–63 | 232/320 | 227/320 | 240/320 |
| All scenarios, seeds 100–107 | 289/352 | 287/352 | 299/352 |

Seeds 32–63 and 100–107 were not used for tuning. Over seeds 0–63 the profile
changed: armor-heavy starts rose from 63/128 to 125/128 and standard starts from
89/128 to 115/128, while ten-rifle starts fell from 115/128 to 71/128 and scarce
ore from 76/128 to 51/128. Early rushes are about level (126/128 to 122/128).
The AI tournament tables in the sections below were measured before these
changes.


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
# 12 seeds, both starting sides, the default scenario (24 Deathmatch games).
cargo run --release --features ai-bench --bin ai-bench

# seed count, first seed, game time limit in seconds, scenario set.
cargo run --release --features ai-bench --bin ai-bench -- 64 10000 360 stock > results.json

# Target a single scenario family.
cargo run --release --features ai-bench --bin ai-bench -- 16 0 360 rush
cargo run --release --features ai-bench --bin ai-bench -- 64 10000 360 balanced
cargo run --release --features ai-bench --bin ai-bench -- 16 0 360 player-armor
cargo run --release --features ai-bench --bin ai-bench -- 16 0 360 mixed-wave
cargo run --release --features ai-bench --bin ai-bench -- 16 0 360 tank-opening

# Compare paired reports and fail if rush wins do not improve or any balanced
# match differs (including duration, surviving material and plan selections).
python3 scripts/compare-ai-bench.py before.json after.json \
  --require-balanced-identical --require-rush-improvement

# Demolition-truck strikes and line defenses, with commanders disabled.
cargo run --release --features ai-bench --bin ai-bench -- --trucks

# Gun-backed defender duels against equal mirror armies, commanders disabled.
cargo run --release --features ai-bench --bin ai-bench -- --defense

# Mirror demos at each difficulty in either game mode: outcome (mirrors
# should not favor a side), plus base completion time and rebuilds in
# Standard (seed count, first seed, time limit). Every other benchmark runs
# Deathmatch, so earlier reports stay comparable.
cargo run --release --features ai-bench --bin ai-bench -- --game-mode standard 8 0 600
cargo run --release --features ai-bench --bin ai-bench -- --game-mode deathmatch 8 0 600

# Optional per-side army, economy, queue and strategy traces go to stderr.
AI_BENCH_TRACE=1 cargo run --release --features ai-bench --bin ai-bench -- 1 26 180 all
```

JSON on stdout records every seed, side, scenario, actual win/loss or timeout,
match duration, surviving army value, plan selections, and what Hard's truck
blasts destroyed net of its own losses (`hard_truck_net`). The plan counters are
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
exercise emergency demolition decisions. `mixed-wave` runs the third player
recording, its minimized 16-order version, and three sustained combined-arms
strategies with attacks at 14, 22, and 32 seconds. The automated armies maintain
a two-rifle/one-rocket infantry mix, expand to two collectors, and build tanks
with remaining factory time and credits. `all` runs all eighteen scenarios. The
legacy `stock_surviving_value` JSON field records the opponent's surviving value,
including for scripted player scenarios.

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


### Counter balance and demolition interceptions

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
unchanged. Rocket damage to collectors and demolition trucks remains 52 (later
lowered to 30 against trucks; see [Demolition trucks](#demolition-trucks)). These
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
after the opening observation. (Since deposit planning, Hard keeps one collector
during recovery, so it normally runs the full window.)

The counter/interception paired tournament used seeds **60000–60031**, both sides, and thirteen
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

### Mixed-army defense regression

The third player export (`3249742994`) reproduced an AI loss at 73.62 seconds.
Its rifle/rocket force attacked at 21.48 seconds and picked off stationary
reserves row by row. Hard required a large global advantage before committing
those reserves, even when its nearby army could support the fight. Reducing the
recording from 30 orders to 16 retained the loss; removing any remaining order
from that minimized replay prevented the recorded win.

Hard now recognizes reserves taking fire from beyond their own range. Against
rocket-heavy lines, it can commit a supported defense without waiting for the
normal assault advantage or wave deadline. This requires a local power advantage
and a competitive total army; opening-rush recovery and retreat decisions still
apply. Tank-dominated lines retain the screened response: indiscriminate release
on contact regressed an armor matchup, which is now a separate regression test.
No unit stats or resource rules changed.

The exact original browser frames and commands now produce an **AI win at 66.20
seconds**. Both earlier player recordings still produce AI wins. Native tests
also replay the full and minimized mixed attack from both starting sides.

The final validation compared the previous commander with this change using
seeds **72000–72015**, both sides and all eighteen scenarios: **576 games per
version**, under identical unit rules:

| Scenario family | Previous wins | Revised wins |
| --- | ---: | ---: |
| Four balanced stock scenarios | 78/128 | 79/128 |
| Advanced-position rush | 30/32 | 30/32 |
| Seven recorded/automated tank strategies | 224/224 | 224/224 |
| No-army, unopposed-wave full matches | 0/32 | 0/32 |
| Full mixed-army recording | 3/32 | 14/32 |
| Minimized mixed-army recording | 23/32 | 28/32 |
| Automated mixed attack at 14 seconds | 10/32 | 32/32 |
| Automated mixed attack at 22 seconds | 10/32 | 32/32 |
| Automated mixed attack at 32 seconds | 2/32 | 4/32 |

Every stock scenario retained or improved its win count, with no timeouts. Mixed
profiles improved from **48/160 to 110/160 wins**. This improves the reproduced
weakness without establishing that Hard always wins mixed-army games; late
banked attacks remain difficult. The no-army interception stress test retains its
previous full-match result.

Run the paired comparison with explicit regression gates:

```sh
cargo run --release --features ai-bench --bin ai-bench -- 16 72000 300 all > after.json
python3 scripts/compare-ai-bench.py before.json after.json \
  --require-stock-nonregression --require-mixed-wave-improvement
```

Local validation reports are `output/mixed-wave/heldout-before.json`,
`output/mixed-wave/final-validation-after.json`, and
`output/mixed-wave/final-validation-comparison.json`. Development comparisons and
rejected probes are retained separately in that ignored directory.

### Demolition trucks

Trucks used to drive at the nearest enemy and go off within 3 units of
whatever they met first. They waited in a rally-grid place among their own
troops, so a stray rifleman or a rocket volley set them off in their own line,
and the Hard and Medium commanders sent them along with attack waves.

Trucks now plan their strikes in `src/demolition.rs`. A blast is valued in
credits: enemy units by cost and health removed, gun emplacements by price,
and other structures at a quarter credit per hit point, or the original half
credit per hit point more when the blast destroys them. Own losses are
subtracted. Each candidate target is scored by a straight drive at it,
stopping at the first enemy body in the way, under fire from every weapon in
range that would choose the truck over the targets it already has, using the
same preferences as combat. Rockets prefer tanks, tanks prefer rifles and
rifles prefer rockets, so a truck that arrives while the enemy is busy with
your troops takes less fire. A truck goes off once its blast is as large as
it can get at the target, or after 0.3 seconds without improvement, such as
when escorts block the way. It never goes off where the blast is worth less
to it than nothing. A truck destroyed on the way still explodes where it is.

Rocket damage to trucks fell from 52 to 30. Three rockets could stop any
charge before; now it takes the first volley of five rockets, or of rockets
and tanks together. Rifles fire too late, so massed rifles are the target a
truck is for.

`ai-bench --trucks` runs the real simulation with commanders disabled. Strikes
send a truck from where it waits at an army in its own rally area; defenses
let a wave walk into a seven-unit line that spent 250 credits on a truck or on
troops. Net is enemy losses minus our own, with the truck counted as spent.
Defense scores include the base damage after the line falls.

| Situation | Old truck net | New truck net |
| --- | ---: | ---: |
| Eight waiting rifles | -70 | -4 |
| Twelve waiting rifles | -21 | 46 |
| Ten waiting, mixed with two rockets and a tank | -108 | 131 |
| Four rockets with four rifles | -40 | 50 |
| Three tanks with five rifles | 20 | -9 |
| Two rifles (strikes a building instead) | -130 | 58 |
| Anti-tank gun with two rifles | -130 | 70 |

| Wave against the line | Old truck | New truck | Tank and rifle | Four rifles |
| --- | ---: | ---: | ---: | ---: |
| Ten rifles | -969 | **350** | -57 | -855 |
| Six rifles, two rockets, a tank | -2522 | **-1579** | -1694 | -2489 |
| Three tanks, two rifles, a rocket | -1983 | **-1002** | -2198 | -1829 |

Waiting reserves are spread over the 3.4 × 2.2 rally grid, so a truck sent at
them only about breaks even; advancing waves are packed and are the better
target. The old truck was the worst way to spend 250 credits on a defense;
the new one is the best in all three.

Hard now fields a truck as soon as it sees at least eight rifles with no tanks
and at most one rocket per four rifles, unless it is already under attack. It
sends a waiting truck alone once a strike from where it stands is worth more
than 300 credits, or at once to intercept an unopposed wave as before, and
never as part of a wave. Medium keeps its own rule for building trucks but
also sends them alone. Tournament results against frozen stock Hard and the
scripted players, at 300 seconds:

| Seeds | Scenarios | Before | After |
| --- | --- | ---: | ---: |
| 0–31 | stock | 244/320 | 272/320 |
| 32–63 | stock | 240/320 | 269/320 |
| 100–107 | all | 299/352 | 306/352 |
| 200–231 | all | 1220/1408 | 1246/1408 |
| 500–563 (held out) | stock | 494/640 | 545/640 |
| 600–663 (held out) | stock | 499/640 | 546/640 |
| 400–431 (held out) | all | 1202/1408 | 1231/1408 |
| 700–731 (held out) | all | 1216/1408 | 1243/1408 |

Every gain is in the ten-rifle start, which Hard now wins in all 592 games
across these sets (previously 347). A truck blast there nets about 465 credits
for its price of 250, and at least 370 in every match; `hard_truck_net` records
this per match. Every other scenario is unchanged except one held-out
scarce-ore match (seed 518, Hard as the southern player), lost after both
versions built the same interception truck at the same moment and it went off
1.3 units from where the old one did. Medium's results against the same opponents are unchanged. The balance
and traffic benchmarks are byte-identical.

Rejected probes:

- Buying a waiting truck whenever the opponent has six infantry and at most
  one tank: the ten-rifle start fell from 38 to 3 of 64 wins (seeds 200–231).
  The truck took the factory slot of the second tank just before the first
  rifle wave.
- Buying a truck whenever a strike from its post looked worth 400 or 500
  credits: most such targets were collectors and buildings at the enemy base,
  which had moved or gained escorts by the time a truck got there. Blasts
  averaged well below the truck's price and wins fell to 1157/1408.
- Counting own losses double: no effect on the lost held-out match, and it
  lost another.

### Anti-tank defense tuning

Guns were too weak to hold a line. Range 16 let massed tanks and rockets close
on the front rank before a gun fired twice, infantry took 8 damage per shot, and
Hard bought a gun only when it had three or more tanks in view and no more
infantry than tanks. The `--defense` duels place a gun-backed defender against
an equal army from its own rally area, with the attacker marching in. Before
the change a gun-backed defender lost all eight mirror armies. After it, the
defender holds seven of eight:

| Mirror army | No gun | Gun, before | Gun, after |
| --- | --- | --- | --- |
| 8 rifles | loses | loses | holds, 31 left |
| 6 rifles, 2 rockets | loses | loses | holds, 38 left |
| 4 rockets, 2 rifles | loses | loses | holds, 64 left |
| 2 tanks, 6 rifles | loses | loses | holds, 321 left |
| 3 tanks, 2 rockets, 1 rifle | loses | loses | holds, 303 left |
| 12 rifles | loses | loses | **loses** |
| 4 tanks, 4 rifles | loses | loses | holds, 331 left |
| 6 rockets | mutual wipe | mutual wipe | holds, 65 left |

The 12-rifle loss is positional. Attackers stop 6.65 units from the front
rank, so their whole wave fires at the front, while the defenders' rear rank
sits 9 units back and cannot reach it. Gun range now covers the approach, and
a single gun changes little against 12 rifles. Fixing it means changing
rally spacing or how units hold, which moves the whole navigation layer, so I
left it for a separate change.

Changes: gun range 16 → 22, interval 2.2 → 2.0 s, damage to infantry and
rockets 8 → 20. The AI buys a gun once the visible opposing army is worth at
least 450 credits (one gun) or 750 (two), unless infantry outnumber their
tanks by more than four, or Hard's own tanks already match theirs. Buying no
longer holds back other orders: a gun is bought only with credits on hand.

Hard, all 22 scenarios, four 64-seed blocks (256 seeds, both sides, 11264 games).
Hard fielded about 0.8 guns per game after the change:

| Scenario | Wins before | Wins after | Losses before | Losses after |
| --- | ---: | ---: | ---: | ---: |
| mixed_assault_late | 216 | 457 | 296 | 55 |
| tank_opening_late | 401 | 458 | 111 | 54 |
| scarce_ore | 237 | 261 | 274 | 248 |
| standard | 453 | 457 | 59 | 55 |
| armor | 502 | 505 | 10 | 7 |
| early_rush | 490 | 494 | 22 | 17 |
| mixed_assault | 510 | 507 | 2 | 5 |
| mixed_assault_early | 511 | 508 | 1 | 4 |
| recorded_mixed | 512 | 510 | 0 | 2 |
| **all** | **9976 / 11264** | **10301 / 11264** | **1287** | **959** |

Mixed attacks lost 2–3 wins each (out of 512), and `recorded_mixed` lost 2.
Those losses are small but real, and I did not find a setting that removed
them without giving back the gains. Other scenarios were unchanged or better.
Medium, on the same opponents and four blocks of 64 seeds, moved by +4, +4,
0 and +8 wins out of 1408 per block.

Rejected:

- Saving money for a gun: holding back other orders while waiting for 200
  credits cost wins in `recorded_mixed` and `mixed_assault`.
- Removing the infantry gate: `recorded_mixed` fell from 128 to 118–122 of 128,
  even though `mixed_assault_late` gained the most.
- A margin of 2 instead of 4 kept `recorded_mixed` at 256/256 but gave back
  most of the `mixed_assault_late` gain (115 instead of 220 of 256).
- Buying only when the enemy's army is worth more than 1.5 times ours: the
  gain on seeds 0–63 fell from +74 to +8.
- Range 16 with up to 24 damage against infantry still lost the rocket and
  mixed duels; range is what turned those into wins.

### Stronger guns (second pass)

Guns were strengthened again: health 320 → 450, interval 2.0 → 1.6 s, turn
rate 1 → 1.6 rad/s, damage to infantry and rockets 20 → 34, and a 2.5-unit
splash that deals half damage to other infantry and rockets near the target
(armor is not splashed). In the `--defense` duels, gun-backed defenders
finish with more left in every mirror army they already held (8 rifles
31 → 70, 6 rifles + 2 rockets 38 → 103, 4 rockets + 2 rifles 64 → 144,
6 rockets 65 → 126). Twelve rifles still beat a single gun (attacker left
202 → 137); that loss is positional, as described above.

Hard, all 22 scenarios, 64 seeds, both sides:

| Seeds | Wins before | Wins after | Lost | Gained |
| --- | ---: | ---: | ---: | ---: |
| 0–63 | 2568 / 2816 | 2591 / 2816 | 1 | 24 |
| 64–127 (held out) | 2576 / 2816 | 2592 / 2816 | 2 | 18 |

The gains come from `tank_opening_late` (+12 on both blocks) and
`mixed_assault_late` (+5), where Hard defends behind its guns.

AI changes considered:

- Hard's purchase gate was re-tested with the stronger guns. An infantry
  margin of 8 or no infantry gate still cost `recorded_mixed` (−2 of 128);
  lower thresholds (350/650) changed nothing. The gate is unchanged.
- Medium waits for a larger wave (3 + 2 per gun reserves, or 4 s longer per
  gun) and asks for 2 more rifles per opposing gun.
- Rejected: requiring Hard to have a wider army advantage per healthy enemy
  gun before an unprovoked wave. Against a stock opponent given two free guns
  it raised Hard from 2051 to 2197 wins of 2816, but Hard-vs-Hard demos stalled
  (no winner by 600 s) on 7–9 of 192 seeds instead of 3. Fading the margin out
  over time, or applying it only while Hard has no gun of its own, did not fix
  it. Recalling unthreatened waves on our half made stalls worse (6 of 192 even
  without the margin).
- Known cost: with the stronger guns alone, 3 of 192 Hard-vs-Hard demos
  (seeds 64–255) still had no winner after 600 s, against none before.
