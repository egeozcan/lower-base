//! Demolition-truck situations, using the real targeting, movement, fire and
//! blasts with commanders disabled. Each strike sends one truck from where it
//! waits at an enemy army waiting in its own rally area. Each defense lets an
//! enemy wave walk into our waiting line, which has spent the truck's price
//! on a truck or on more troops.
use super::*;

#[derive(Serialize)]
pub struct TruckResult {
    pub scenario: &'static str,
    /// For defenses: what the line added for 250 credits.
    pub addition: &'static str,
    /// Credits of units and structures destroyed, by health lost. Guns are
    /// worth their price; other structures a quarter credit per hit point,
    /// and half a credit per original hit point more once destroyed.
    pub enemy_lost: f32,
    /// The same for our side, excluding the truck itself.
    pub friendly_lost: f32,
    pub exploded: bool,
    /// Enemy losses minus ours, with the truck counted as spent.
    pub net: f32,
}

// Enemy rally-area compositions, in the order a commander fields them, and
// whether a finished anti-tank gun stands on the left pad behind them.
const STRIKES: [(&str, &[UnitKind], bool); 8] = {
    use UnitKind::{Rocket as R, Soldier as S, Tank as T};
    [
        ("rifle_reserve", &[S, S, S, S, S, S, S, S], false),
        (
            "large_rifle_reserve",
            &[S, S, S, S, S, S, S, S, S, S, S, S],
            false,
        ),
        ("mixed_reserve", &[S, S, R, S, S, T, S, S, R, S], false),
        ("rifles_and_two_rockets", &[S, S, S, R, S, S, S, R], false),
        ("rocket_reserve", &[R, S, R, S, R, S, R, S], false),
        ("armored_reserve", &[T, S, T, S, T, S, S, S], false),
        ("rifle_scouts", &[S, S], false),
        ("guarded_gun", &[S, S], true),
    ]
};

// Each wave is worth about as much as the line before its 250-credit addition.
const WAVES: [(&str, &[UnitKind]); 3] = {
    use UnitKind::{Rocket as R, Soldier as S, Tank as T};
    [
        ("rifle_wave", &[S, S, S, S, S, S, S, S, S, S]),
        ("mixed_wave", &[S, S, R, S, T, S, S, R, S]),
        ("armored_wave", &[T, T, S, T, R, S]),
    ]
};

fn value(game: &Game, team: Team) -> f32 {
    game.units
        .iter()
        .filter(|u| u.team == team && u.hp > 0.0 && u.kind != UnitKind::Demolition)
        .map(|u| u.kind.cost() * u.hp / u.max_hp)
        .sum::<f32>()
        + game
            .buildings
            .iter()
            .filter(|b| b.team == team && b.hp > 0.0)
            .map(|b| match b.kind {
                BuildingKind::Emplacement => EMPLACEMENT_COST * b.hp / b.max_hp,
                _ => 0.25 * b.hp + 0.5 * b.max_hp,
            })
            .sum::<f32>()
}

/// Units start where they wait, as if they had walked there.
fn field(game: &mut Game, team: Team, kind: UnitKind) -> u32 {
    game.spawn(team, kind);
    let u = game.units.last_mut().unwrap();
    u.x = u.rally_x;
    u.z = u.rally_z;
    u.id
}

fn quiet() -> Game {
    let mut game = Game::with_seed(26);
    game.units.clear();
    game.ai_decision_timer = f32::INFINITY;
    game
}

fn settle(game: &mut Game) {
    for _ in 0..40 {
        game.update(0.05);
    }
}

fn strike(name: &'static str, kinds: &[UnitKind], gun: bool) -> TruckResult {
    let mut game = quiet();
    for &kind in kinds {
        field(&mut game, Team::Enemy, kind);
    }
    if gun {
        game.build_emplacement_for(Team::Enemy, 0);
        for b in &mut game.buildings {
            b.construction_remaining = 0.0;
        }
    }
    let truck = field(&mut game, Team::Player, UnitKind::Demolition);
    settle(&mut game);
    game.attack_selected(&[truck]);
    let enemy_before = value(&game, Team::Enemy);
    let mut exploded = false;
    let mut gone_at = None;
    for _ in 0..(30.0 / 0.05) as usize {
        game.update(0.05);
        exploded |= !game.explosions.is_empty();
        if gone_at.is_none() && !game.units.iter().any(|u| u.id == truck) {
            gone_at = Some(game.time);
        }
        // Score the strike itself, not the fighting that follows.
        if gone_at.is_some_and(|t| game.time - t > 2.0) {
            break;
        }
    }
    let enemy_lost = enemy_before - value(&game, Team::Enemy);
    TruckResult {
        scenario: name,
        addition: "truck",
        enemy_lost,
        friendly_lost: 0.0,
        exploded,
        net: enemy_lost - UnitKind::Demolition.cost(),
    }
}

fn defense(name: &'static str, wave: &[UnitKind], addition: &'static str) -> TruckResult {
    use UnitKind::{Rocket as R, Soldier as S, Tank as T};
    let mut game = quiet();
    let added: &[UnitKind] = match addition {
        "truck" => &[UnitKind::Demolition],
        "tank_and_rifle" => &[T, S],
        _ => &[S, S, S, S],
    };
    // The truck is built last, as it would be once the line exists.
    for &kind in [S, S, R, T, S, R, S].iter().chain(added) {
        field(&mut game, Team::Player, kind);
    }
    settle(&mut game);
    for (i, &kind) in wave.iter().enumerate() {
        game.spawn(Team::Enemy, kind);
        let u = game.units.last_mut().unwrap();
        u.x = (i % 5) as f32 * 2.4 - 4.8;
        u.z = -4.0 + (i / 5) as f32 * 2.2;
        u.state = UnitState::Attack;
    }
    let enemy_before = value(&game, Team::Enemy);
    let friendly_before = value(&game, Team::Player);
    let mut exploded = false;
    for _ in 0..(45.0 / 0.05) as usize {
        game.update(0.05);
        exploded |= !game.explosions.is_empty();
        if !game.units.iter().any(|u| u.team == Team::Enemy) {
            break;
        }
    }
    let enemy_lost = enemy_before - value(&game, Team::Enemy);
    let friendly_lost = friendly_before - value(&game, Team::Player);
    // Troops bought instead count against us only when they are destroyed.
    let spent = if addition == "truck" {
        UnitKind::Demolition.cost()
    } else {
        0.0
    };
    TruckResult {
        scenario: name,
        addition,
        enemy_lost,
        friendly_lost,
        exploded,
        net: enemy_lost - friendly_lost - spent,
    }
}

pub fn runs() -> Vec<TruckResult> {
    let mut results: Vec<_> = STRIKES
        .into_iter()
        .map(|(name, kinds, gun)| strike(name, kinds, gun))
        .collect();
    for (name, wave) in WAVES {
        for addition in ["truck", "tank_and_rifle", "four_rifles"] {
            results.push(defense(name, wave, addition));
        }
    }
    results
}
