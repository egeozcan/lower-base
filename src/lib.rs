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

    pub fn attack_selected(&mut self, ids: &[u32]) {
        self.game.attack_selected(ids);
    }

    pub fn snapshot(&self) -> String {
        serde_json::to_string(&self.game).expect("game state should always serialize")
    }
}

impl Default for GameBridge {
    fn default() -> Self {
        Self::new(1941)
    }
}
