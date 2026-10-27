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

- Queue rifle infantry and rocket troopers at the barracks, and tanks, demolition trucks, or ore collectors at the factory. Credits replenish over time; collectors bring in additional income.
- **Demolition Truck** costs 250 credits and takes 6 seconds at the factory. Only one may be alive or queued per side; its slot opens after it explodes. It has 140 HP, moves slightly faster than a tank, and detonates at close range or when destroyed. The blast deals 450 damage within 2 units, falling linearly to zero at radius 7. It damages **all units and buildings, including allies**, and can trigger other trucks. Building damage uses the nearest edge of the footprint. Send it separately from your troops: rockets can stop it at range, tanks survive near the outer edge of the blast, and a full-health building survives even a direct blast. The AI occasionally fields one against large infantry armies and builds extra rockets against yours.
- Both sides start with a refinery. Ore fields are randomly generated each match with equal amounts and positions rotated 180 degrees between the bases. Build an **Ore Collector** for 200 credits; it automatically mines ore and delivers up to 100 credits per trip to your refinery. Ore depletes as it is mined, and collectors move on to the next field.
- Collectors are unarmed and operate independently of Gather, Attack, and unit selection. Protect them and your refinery to keep ore income flowing. The opposing commander also builds collectors.
- Click a gathered unit to select it; Shift-click to add or remove units. On touchscreens, tap units to toggle their selection. Tap empty ground to clear it. Use **Send** to commit the selected units.
- Use **Base** to zoom into your rally area for easier selection and **Map** to see the full battlefield.
- Keyboard shortcuts: `1` Gather, `2` Attack, `3` rifle infantry, `4` rocket trooper, `5` tank, `6` ore collector, `7` demolition truck, `Enter` send selected, `Esc` clear selection.
- **Gather** keeps newly produced troops in front of your base. Select gathered units individually or as a group and send only those troops north.
- **Attack** sends all gathered troops north and automatically sends newly produced troops into battle. Units committed to an attack cannot be recalled or controlled.
- Eliminate all enemy units and buildings to win. You lose when all your units and buildings are destroyed.

The opposing commander adjusts its production to your army. There is no building placement in this version.

## Development

The Rust game simulation lives in `src/simulation.rs`, with a small WebAssembly bridge in `src/lib.rs`. The browser UI and renderer live in `web/`. Run `cargo test` for the simulation tests; rebuild the WebAssembly module after changing Rust code.
