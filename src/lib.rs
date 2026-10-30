//! Rust simulation and WebAssembly bridge for Lower Base.

pub mod simulation;

use simulation::{Difficulty, Game};
use wasm_bindgen::prelude::*;

/// Browser-facing wrapper around the game simulation.
#[wasm_bindgen]
pub struct GameBridge {
    game: Game,
}

#[wasm_bindgen]
impl GameBridge {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> GameBridge {
        Self {
            game: Game::with_seed(seed),
        }
    }

    pub fn demo(seed: u32) -> GameBridge {
        Self {
            game: Game::demo_with_seed(seed),
        }
    }

    pub fn with_difficulty(seed: u32, difficulty: &str, demo: bool) -> GameBridge {
        let difficulty = Difficulty::parse(difficulty);
        Self {
            game: if demo {
                Game::demo_with_difficulty(seed, difficulty)
            } else {
                Game::with_difficulty(seed, difficulty)
            },
        }
    }

    pub fn update(&mut self, dt: f32) {
        self.game.update(dt);
    }

    pub fn set_mode(&mut self, mode: &str) {
        self.game.set_mode(mode);
    }

    pub fn train(&mut self, kind: &str) {
        self.game.train(kind);
    }

    pub fn build_emplacement(&mut self, slot: usize) {
        self.game.build_emplacement(slot);
    }

    pub fn cancel_training(&mut self, building: &str, index: usize) {
        self.game.cancel_training(building, index);
    }

    pub fn eject_garrisoned(&mut self, id: u32) {
        self.game.eject_garrisoned(id);
    }

    pub fn attack_selected(&mut self, ids: &[u32]) {
        self.game.attack_selected(ids);
    }

    pub fn snapshot(&self) -> String {
        serde_json::to_string(&self.game).expect("game state should always serialize")
    }

    /// Internal state is available only in explicitly instrumented local builds.
    #[cfg(feature = "dev-debug")]
    pub fn debug_snapshot(&self) -> String {
        self.game.debug_snapshot()
    }
}

impl Default for GameBridge {
    fn default() -> Self {
        Self::new(1941)
    }
}
