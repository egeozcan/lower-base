//! Static-defense duels using the real targeting, movement, fire and damage
//! with commanders disabled. A defender holds its rally area with the same
//! army as the attacker, optionally with a finished anti-tank gun on its
//! left pad. The attacker walks in as a mirror wave. A defended position
//! should beat an equal army; a gun is the only difference between runs.
use super::*;

#[derive(Serialize)]
pub struct DuelResult {
    pub army: &'static str,
    pub gun: bool,
    /// Whether the defender still has units on the field when the duel ends.
    pub defender_holds: bool,
    pub attacker_value_left: f32,
    pub defender_value_left: f32,
    pub seconds: f32,
}

const ARMIES: [(&str, &[UnitKind]); 8] = {
    use UnitKind::{Rocket as R, Soldier as S, Tank as T};
    [
        ("rifles_8", &[S, S, S, S, S, S, S, S]),
        ("rifles_6_rockets_2", &[S, S, R, S, S, S, R, S]),
        ("rockets_4_rifles_2", &[R, S, R, S, R, S]),
        ("tanks_2_rifles_6", &[T, S, S, T, S, S, S, S]),
        ("tanks_3_rockets_2", &[T, R, T, S, T, R]),
        ("rifles_12", &[S, S, S, S, S, S, S, S, S, S, S, S]),
        ("tanks_4_rifles_4", &[T, S, T, S, T, S, T, S]),
        ("rockets_6", &[R, R, R, R, R, R]),
    ]
};

fn value(game: &Game, team: Team) -> f32 {
    game.units
        .iter()
        .filter(|u| u.team == team && u.hp > 0.0)
        .map(|u| u.kind.cost() * u.hp / u.max_hp)
        .sum()
}

fn duel(name: &'static str, army: &[UnitKind], gun: bool) -> DuelResult {
    let mut game = Game::with_seed(26);
    game.units.clear();
    game.ai_decision_timer = f32::INFINITY;
    if gun {
        game.build_emplacement_for(Team::Player, 0);
        for b in &mut game.buildings {
            b.construction_remaining = 0.0;
        }
    }
    // Defenders wait at their rally grid, as they would at home.
    for &kind in army {
        game.spawn(Team::Player, kind);
        let u = game.units.last_mut().unwrap();
        u.x = u.rally_x;
        u.z = u.rally_z;
    }
    for &kind in army {
        game.spawn(Team::Enemy, kind);
        let u = game.units.last_mut().unwrap();
        u.x = u.rally_x;
        u.z = u.rally_z;
    }
    // Attackers march from their own rally area; defenders hold theirs.
    for u in game.units.iter_mut().filter(|u| u.team == Team::Enemy) {
        u.state = UnitState::Attack;
    }
    let steps = (60.0 / 0.05) as usize;
    let mut seconds = 60.0;
    for step in 0..steps {
        game.update(0.05);
        let attacker_alive = game
            .units
            .iter()
            .any(|u| u.team == Team::Enemy && u.hp > 0.0);
        let defender_alive = game
            .units
            .iter()
            .any(|u| u.team == Team::Player && u.hp > 0.0);
        if !attacker_alive || !defender_alive {
            seconds = (step + 1) as f32 * 0.05;
            break;
        }
    }
    let defender_value_left = value(&game, Team::Player);
    let attacker_value_left = value(&game, Team::Enemy);
    DuelResult {
        army: name,
        gun,
        defender_holds: defender_value_left > attacker_value_left,
        attacker_value_left,
        defender_value_left,
        seconds,
    }
}

pub fn runs() -> Vec<DuelResult> {
    let mut results = Vec::new();
    for (name, army) in ARMIES {
        for gun in [false, true] {
            results.push(duel(name, army, gun));
        }
    }
    results
}
