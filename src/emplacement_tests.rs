use super::*;

fn quiet_game() -> Game {
    let mut game = Game::with_difficulty(42, Difficulty::Hard);
    game.units.clear();
    game.ai_decision_timer = f32::INFINITY;
    game
}

#[test]
fn fixed_slots_charge_both_sides_and_reject_invalid_or_duplicate_purchases() {
    let mut game = quiet_game();
    assert_eq!(game.defense_slots.len(), 4);
    assert_eq!(game.buildings.len(), 8, "empty pads are not structures");
    for team in [Team::Player, Team::Enemy] {
        assert!(!game.build_emplacement_for(team, 2));
        assert!(game.build_emplacement_for(team, 0));
        assert!(!game.build_emplacement_for(team, 0));
        assert!(game.build_emplacement_for(team, 1));
        let guns: Vec<_> = game
            .buildings
            .iter()
            .filter(|b| b.team == team && b.kind == BuildingKind::Emplacement)
            .collect();
        assert_eq!(guns.len(), 2);
        assert_eq!(guns[0].x, -7.0);
        assert_eq!(guns[1].x, 7.0);
        assert_eq!(guns[0].z.abs(), 34.0);
    }
    assert_eq!(game.credits, 100.0);
    assert_eq!(game.ai_credits, 100.0);
    assert!(game.factory_queue.is_empty());
    assert!(game.barracks_queue.is_empty());
}

#[test]
fn purchase_requires_money_command_and_live_match_and_demo_ignores_player_orders() {
    let mut game = quiet_game();
    game.credits = EMPLACEMENT_COST - 1.0;
    game.build_emplacement(0);
    assert_eq!(game.buildings.len(), 8);
    game.credits = EMPLACEMENT_COST;
    game.demo = true;
    game.build_emplacement(0);
    assert_eq!(game.credits, EMPLACEMENT_COST);
    game.demo = false;
    game.outcome = Outcome::Victory;
    game.build_emplacement(0);
    assert_eq!(game.credits, EMPLACEMENT_COST);
    game.outcome = Outcome::Playing;
    game.buildings
        .retain(|b| b.team != Team::Player || b.kind != BuildingKind::Command);
    game.build_emplacement(0);
    assert_eq!(game.credits, EMPLACEMENT_COST);
    assert!(!game.alive_building(Team::Player, BuildingKind::Emplacement));
}

#[test]
fn construction_is_vulnerable_does_not_fire_and_destroyed_slots_can_be_rebuilt() {
    let mut game = quiet_game();
    game.build_emplacement(0);
    let id = game.buildings.last().unwrap().id;
    game.spawn(Team::Enemy, UnitKind::Soldier);
    let rifle = game.units.last_mut().unwrap();
    rifle.x = -7.0;
    rifle.z = 28.0;
    rifle.cooldown = 0.0;
    rifle.state = UnitState::Attack;
    game.combat_and_move(0.05);
    let gun = game.buildings.iter_mut().find(|b| b.id == id).unwrap();
    assert_eq!(gun.hp, EMPLACEMENT_HEALTH - 24.0);
    assert!(gun.construction_remaining > 7.9);
    assert!(game.shots.iter().all(|s| s.source_id != id));
    game.buildings.iter_mut().find(|b| b.id == id).unwrap().hp = 0.0;
    game.units.clear();
    game.update(0.05);
    let credits = game.credits;
    game.build_emplacement(0);
    assert_eq!(game.credits, credits - EMPLACEMENT_COST);
    let rebuilt = game.buildings.last().unwrap();
    assert_ne!(rebuilt.id, id);
    assert_eq!(rebuilt.construction_remaining, EMPLACEMENT_BUILD_TIME);
}

fn assault(kind: UnitKind, count: usize) -> Game {
    let mut game = quiet_game();
    game.build_emplacement(0);
    game.build_emplacement(1);
    for b in &mut game.buildings {
        b.construction_remaining = 0.0;
    }
    // Isolate the guns from command-center fire and mobile defenders.
    game.buildings
        .retain(|b| b.kind == BuildingKind::Emplacement);
    for i in 0..count {
        game.spawn(Team::Enemy, kind);
        let unit = game.units.last_mut().unwrap();
        unit.x = (i as f32 - (count - 1) as f32 / 2.0) * 3.0;
        unit.z = 12.0;
        unit.state = UnitState::Attack;
    }
    for _ in 0..1200 {
        game.update(0.05);
        if game.outcome != Outcome::Playing {
            break;
        }
    }
    game
}

#[test]
fn prepared_pair_beats_three_tanks_but_loses_to_seven_rifles() {
    let tanks = assault(UnitKind::Tank, 3);
    assert_eq!(
        tanks.outcome,
        Outcome::Victory,
        "400-credit guns should stop 450-credit armor"
    );
    let rifles = assault(UnitKind::Soldier, 7);
    assert_eq!(
        rifles.outcome,
        Outcome::Defeat,
        "420-credit infantry should clear unsupported guns"
    );
}

#[test]
fn guns_prioritize_armor_need_to_turn_and_ignore_garrisons() {
    let mut game = quiet_game();
    game.build_emplacement(0);
    let id = game.buildings.last().unwrap().id;
    game.buildings.last_mut().unwrap().construction_remaining = 0.0;
    for kind in [UnitKind::Soldier, UnitKind::Tank] {
        game.spawn(Team::Enemy, kind);
        let unit = game.units.last_mut().unwrap();
        unit.x = -7.0;
        unit.z = 20.0;
    }
    game.combat_and_move(0.05);
    assert_eq!(game.units[0].hp, 100.0);
    assert_eq!(game.units[1].hp, 180.0);
    assert!(game
        .shots
        .iter()
        .any(|s| s.source_id == id && !s.source_is_unit));
    game.units[1].state = UnitState::Garrison;
    game.units[0].z = 46.0;
    game.buildings.last_mut().unwrap().cooldown = 0.0;
    game.shots.clear();
    game.combat_and_move(0.05);
    assert!(
        game.shots.iter().all(|s| s.source_id != id),
        "cannot instantly turn around"
    );
    game.units[0].state = UnitState::Garrison;
    game.buildings.last_mut().unwrap().facing = 0.0;
    game.combat_and_move(0.05);
    assert!(game.shots.iter().all(|s| s.source_id != id));
}

#[test]
fn ai_keeps_reinforcing_when_its_mobile_armor_already_matches_the_threat() {
    let mut game = quiet_game();
    for team in [Team::Player, Team::Enemy] {
        for _ in 0..3 {
            game.spawn(team, UnitKind::Tank);
        }
    }
    game.prepare_emplacement(Team::Enemy);
    assert!(!game.alive_building(Team::Enemy, BuildingKind::Emplacement));
    assert_eq!(game.ai_credits, STARTING_CREDITS);
}

#[test]
fn ai_saves_for_visible_armor_but_avoids_hidden_units_and_overrun_pads() {
    for team in [Team::Player, Team::Enemy] {
        let mut game = quiet_game();
        let opponent = if team == Team::Player {
            Team::Enemy
        } else {
            Team::Player
        };
        for _ in 0..3 {
            game.spawn(opponent, UnitKind::Tank);
            game.units.last_mut().unwrap().state = UnitState::Garrison;
        }
        assert!(!game.prepare_emplacement(team));
        assert!(!game.alive_building(team, BuildingKind::Emplacement));
        for unit in &mut game.units {
            unit.state = UnitState::Attack;
        }
        if team == Team::Player {
            game.credits = 100.0;
        } else {
            game.ai_credits = 100.0;
        }
        assert!(
            game.prepare_emplacement(team),
            "reserve money until affordable"
        );
        if team == Team::Player {
            game.credits = 200.0;
        } else {
            game.ai_credits = 200.0;
        }
        assert!(!game.prepare_emplacement(team));
        assert!(game.alive_building(team, BuildingKind::Emplacement));
        game.buildings
            .retain(|b| b.kind != BuildingKind::Emplacement);
        for unit in &mut game.units {
            unit.x = 0.0;
            unit.z = if team == Team::Player { 30.0 } else { -30.0 };
        }
        assert!(!game.prepare_emplacement(team));
        assert!(!game.alive_building(team, BuildingKind::Emplacement));
    }
}
