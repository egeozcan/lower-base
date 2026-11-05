use super::*;

fn standard() -> Game {
    let mut game = Game::with_options(7, Difficulty::Medium, GameMode::Standard);
    game.ai_decision_timer = f32::INFINITY;
    game
}

fn run(game: &mut Game, seconds: f32) {
    for _ in 0..(seconds / 0.05).round() as usize {
        game.update(0.05);
    }
}

fn structures(game: &Game, team: Team) -> Vec<BuildingKind> {
    game.buildings
        .iter()
        .filter(|b| b.team == team && b.kind != BuildingKind::Command)
        .map(|b| b.kind)
        .collect()
}

#[test]
fn standard_starts_from_a_lone_command_center_with_marked_sites() {
    let game = standard();
    assert_eq!(game.game_mode, GameMode::Standard);
    assert!(game.units.is_empty());
    assert_eq!(game.buildings.len(), 2);
    assert!(game
        .buildings
        .iter()
        .all(|b| b.kind == BuildingKind::Command));
    assert_eq!(game.sites.len(), 6, "empty sites are not structures");
    assert_eq!(game.credits, STANDARD_STARTING_CREDITS);
    assert_eq!(game.ai_credits, STANDARD_STARTING_CREDITS);

    let deathmatch = Game::with_difficulty(7, Difficulty::Medium);
    assert_eq!(deathmatch.game_mode, GameMode::Deathmatch);
    assert!(deathmatch.sites.is_empty());
    assert_eq!(deathmatch.buildings.len(), 8);
    for site in &game.sites {
        let b = deathmatch
            .buildings
            .iter()
            .find(|b| b.team == site.team && b.kind == site.kind)
            .unwrap();
        assert_eq!((b.x, b.z), (site.x, site.z), "sites keep the base layout");
    }
}

#[test]
fn passive_income_follows_the_game_mode() {
    let mut game = standard();
    run(&mut game, 2.0);
    assert!((game.credits - (STANDARD_STARTING_CREDITS + 10.0)).abs() < 0.01);
    let mut deathmatch = Game::with_difficulty(7, Difficulty::Medium);
    deathmatch.ai_decision_timer = f32::INFINITY;
    run(&mut deathmatch, 2.0);
    assert!((deathmatch.credits - (STARTING_CREDITS + 48.0)).abs() < 0.01);
}

#[test]
fn one_structure_at_a_time_paid_up_front_on_its_own_site() {
    let mut game = standard();
    game.construct("barracks");
    assert_eq!(game.credits, STANDARD_STARTING_CREDITS - 400.0);
    let barracks = game.buildings.last().unwrap();
    assert_eq!(barracks.kind, BuildingKind::Barracks);
    assert_eq!(
        (barracks.x, barracks.z),
        BuildingKind::Barracks.home(Team::Player)
    );
    assert_eq!(barracks.hp, barracks.max_hp, "full health while building");
    assert_eq!(barracks.construction_remaining, 15.0);
    // Busy command center: no queue, no second structure, no duplicate.
    game.construct("factory");
    game.construct("barracks");
    game.construct("command");
    assert_eq!(structures(&game, Team::Player), [BuildingKind::Barracks]);
    assert_eq!(game.credits, STANDARD_STARTING_CREDITS - 400.0);
    // Guns build independently on their pads.
    game.build_emplacement(0);
    assert_eq!(game.credits, STANDARD_STARTING_CREDITS - 600.0);
    run(&mut game, 15.2);
    game.construct("barracks");
    game.construct("factory");
    assert!((game.credits - (STANDARD_STARTING_CREDITS - 1400.0 + 76.0)).abs() < 0.01);
    assert!(game.standing(Team::Player, BuildingKind::Factory));
}

#[test]
fn construction_requires_standard_a_command_center_credits_and_a_live_match() {
    let mut deathmatch = Game::with_difficulty(7, Difficulty::Medium);
    deathmatch
        .buildings
        .retain(|b| b.kind != BuildingKind::Barracks);
    deathmatch.construct("barracks");
    assert!(!deathmatch.standing(Team::Player, BuildingKind::Barracks));
    assert_eq!(deathmatch.credits, STARTING_CREDITS);

    let mut game = standard();
    game.credits = 399.0;
    game.construct("barracks");
    assert!(!game.standing(Team::Player, BuildingKind::Barracks));
    game.credits = 400.0;
    game.demo = true;
    game.construct("barracks");
    assert!(!game.standing(Team::Player, BuildingKind::Barracks));
    game.demo = false;
    game.buildings
        .retain(|b| b.team != Team::Player || b.kind != BuildingKind::Command);
    game.construct("barracks");
    assert!(!game.standing(Team::Player, BuildingKind::Barracks));
    assert_eq!(game.credits, 400.0);
}

#[test]
fn structures_under_construction_do_not_produce_and_can_be_destroyed() {
    let mut game = standard();
    game.construct("barracks");
    game.train("soldier");
    assert!(game.barracks_queue.is_empty());
    run(&mut game, 14.9);
    game.train("soldier");
    assert!(game.barracks_queue.is_empty());
    run(&mut game, 0.2);
    game.train("soldier");
    assert_eq!(game.barracks_queue, [UnitKind::Soldier]);

    // A destroyed structure frees its site for a full-price rebuild.
    game.buildings
        .iter_mut()
        .find(|b| b.kind == BuildingKind::Barracks)
        .unwrap()
        .hp = 0.0;
    run(&mut game, 0.05);
    assert!(game.barracks_queue.is_empty());
    let credits = game.credits;
    game.construct("barracks");
    assert_eq!(game.credits, credits - 400.0);
}

#[test]
fn every_finished_refinery_brings_one_mining_collector() {
    let mut game = standard();
    game.construct("refinery");
    run(&mut game, 19.9);
    assert!(
        game.units.is_empty(),
        "no collector until the refinery is done"
    );
    game.mode = Mode::Retreat;
    run(&mut game, 0.2);
    let collectors: Vec<_> = game
        .units
        .iter()
        .filter(|u| u.team == Team::Player && u.kind == UnitKind::Collector)
        .collect();
    assert_eq!(collectors.len(), 1);
    assert_eq!(
        collectors[0].state,
        UnitState::Harvest,
        "mines even in Retreat"
    );
    assert!(collectors[0].garrison.is_none());

    // Collectors are trained only while a finished refinery stands.
    game.construct("factory");
    run(&mut game, 25.2);
    game.buildings
        .retain(|b| b.team != Team::Player || b.kind != BuildingKind::Refinery);
    game.credits = CREDIT_CAP;
    game.train("collector");
    assert!(game.factory_queue.is_empty());
    game.construct("refinery");
    game.train("collector");
    assert!(game.factory_queue.is_empty());
    run(&mut game, 20.2);
    game.train("collector");
    assert_eq!(game.factory_queue, [UnitKind::Collector]);
    let collectors = game
        .units
        .iter()
        .filter(|u| u.team == Team::Player && u.kind == UnitKind::Collector)
        .count();
    assert_eq!(collectors, 2, "a rebuilt refinery brings another collector");
}

#[test]
fn every_difficulty_builds_its_base_in_order_and_plays_on() {
    for difficulty in [Difficulty::Easy, Difficulty::Medium, Difficulty::Hard] {
        for seed in [3, 11] {
            let mut game = Game::demo_with_options(seed, difficulty, GameMode::Standard);
            let mut order = [Vec::new(), Vec::new()];
            for _ in 0..(150.0 / 0.05) as usize {
                game.update(0.05);
                for (i, team) in [Team::Player, Team::Enemy].into_iter().enumerate() {
                    for b in game.buildings.iter().filter(|b| b.team == team) {
                        if b.kind != BuildingKind::Command
                            && b.kind != BuildingKind::Emplacement
                            && !order[i].contains(&b.kind)
                        {
                            order[i].push(b.kind);
                        }
                    }
                }
            }
            for (i, team) in [Team::Player, Team::Enemy].into_iter().enumerate() {
                assert_eq!(
                    order[i],
                    BuildingKind::SITE_STRUCTURES,
                    "{difficulty:?} seed {seed} {team:?}"
                );
            }
            assert!(
                game.units.iter().any(|u| u.kind != UnitKind::Collector),
                "{difficulty:?} seed {seed}: armies are fielded"
            );
        }
    }
}
