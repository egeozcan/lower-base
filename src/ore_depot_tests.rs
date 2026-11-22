use super::*;

fn quiet_game() -> Game {
    let mut game = Game::with_difficulty(42, Difficulty::Hard);
    game.units.clear();
    game.ai_decision_timer = f32::INFINITY;
    game
}

fn step_secs(game: &mut Game, secs: f32) {
    let steps = (secs / 0.05).round() as usize;
    for _ in 0..steps {
        game.update(0.05);
    }
}

#[test]
fn ore_depot_prerequisites_parallel_build_and_rebuild() {
    let mut game = Game::with_options(42, Difficulty::Hard, GameMode::Standard);
    game.ai_decision_timer = f32::INFINITY;
    game.credits = 2000.0;

    // Missing refinery + collector: rejected with 0 spend.
    game.build_pad("ore_depot");
    assert_eq!(game.credits, 2000.0);
    assert!(!game.standing(Team::Player, BuildingKind::OreDepot));

    // Refinery still under construction: still rejected.
    game.construct("refinery");
    game.build_pad("ore_depot");
    assert!(!game.standing(Team::Player, BuildingKind::OreDepot));

    // Finish refinery (spawns 1 free collector); build barracks + ore depot in parallel.
    step_secs(&mut game, 20.1);
    assert!(game.alive_building(Team::Player, BuildingKind::Refinery));
    game.credits = 1000.0;
    game.construct("barracks");
    game.build_pad("ore_depot");
    assert_eq!(
        game.credits,
        1000.0 - BuildingKind::Barracks.cost() - ORE_DEPOT_COST
    );

    let depot_id = game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .expect("ore depot should construct in parallel with barracks")
        .id;
    let depot = game.buildings.iter().find(|b| b.id == depot_id).unwrap();
    assert_eq!(depot.max_hp, ORE_DEPOT_HEALTH);
    assert!((depot.construction_remaining - ORE_DEPOT_BUILD_TIME).abs() < 1e-4);

    // Unfinished depot refuses unloading.
    assert!(depot.construction_remaining > 0.0);

    // Destroy and rebuild on freed pad.
    game.buildings.iter_mut().find(|b| b.id == depot_id).unwrap().hp = 0.0;
    game.update(0.05);
    assert!(!game.buildings.iter().any(|b| b.id == depot_id));

    game.credits = 500.0;
    game.build_pad("ore_depot");
    assert_eq!(game.credits, 500.0 - ORE_DEPOT_COST);
    let rebuilt = game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .unwrap();
    assert_ne!(rebuilt.id, depot_id);

    // Queued collector also satisfies prerequisite even with 0 alive collectors.
    game.units
        .retain(|u| u.team != Team::Player || u.kind != UnitKind::Collector);
    game.buildings.retain(|b| b.team != Team::Player || !b.kind.is_pad_structure());
    let factory = Building {
        id: 999,
        team: Team::Player,
        kind: BuildingKind::Factory,
        x: -10.0,
        z: 43.5,
        hp: 1000.0,
        max_hp: 1000.0,
        cooldown: 0.0,
        facing: 0.0,
        defense_slot: None,
        construction_time: 0.0,
        construction_remaining: 0.0,
        stored_ore: 0.0,
    };
    game.buildings.push(factory);
    game.factory_queue.push(UnitKind::Collector);
    game.credits = ORE_DEPOT_COST;
    game.build_pad("ore_depot");
    assert!(game.standing(Team::Player, BuildingKind::OreDepot));
}

#[test]
fn pad_smart_slot_selection_fills_optimal_flanks_and_rejects_third() {
    let mut game = quiet_game();
    game.credits = 2000.0;
    game.spawn(Team::Player, UnitKind::Collector);
    // Bias remaining ore heavily to Left (-x) on player half.
    for o in &mut game.ore {
        if o.z > 0.0 {
            o.amount = if o.x < 0.0 { 1800.0 } else { 200.0 };
        }
    }
    game.build_pad("ore_depot");
    let first = game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .unwrap();
    assert_eq!(first.defense_slot, Some(0), "depot prefers richer Left flank");

    // Second pad buys an AT gun onto remaining Right slot (1).
    game.build_pad("emplacement");
    let gun = game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::Emplacement)
        .unwrap();
    assert_eq!(gun.defense_slot, Some(1));

    // Third pad purchase is rejected and charges nothing.
    let before = game.credits;
    game.build_pad("ore_depot");
    game.build_pad("emplacement");
    assert_eq!(game.credits, before);

    // Verify AT gun prefers threatened flank, and Depot tie-breaks East (1) on symmetric ore.
    let mut sym = quiet_game();
    sym.credits = 2000.0;
    for o in &mut sym.ore {
        o.amount = 1000.0;
    }
    sym.spawn(Team::Player, UnitKind::Collector);
    sym.build_pad("ore_depot");
    let tie_depot = sym
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .unwrap();
    assert_eq!(tie_depot.defense_slot, Some(1), "symmetric map tie-breaks depot East (slot 1)");

    // Gun vs Right threat when both open.
    let mut threat_game = quiet_game();
    threat_game.credits = 2000.0;
    threat_game.spawn(Team::Enemy, UnitKind::Tank);
    let t = threat_game.units.last_mut().unwrap();
    t.x = 7.0;
    t.z = 16.0;
    threat_game.build_pad("emplacement");
    let threatened_gun = threat_game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::Emplacement)
        .unwrap();
    assert_eq!(threatened_gun.defense_slot, Some(1), "gun picks threatened flank");
}

#[test]
fn collector_unloads_on_outer_flank_in_1_5s_and_streams_at_12_5_per_sec() {
    let mut game = quiet_game();
    game.credits = 500.0;
    game.spawn(Team::Player, UnitKind::Collector);
    game.build_pad("ore_depot");
    let depot_idx = game
        .buildings
        .iter()
        .position(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .unwrap();
    game.buildings[depot_idx].construction_remaining = 0.0;
    let (ux, uz) = depot_unload_point(&game.buildings[depot_idx]);
    assert!(ux.abs() > 10.2, "unload point ({ux}, {uz}) must clear the rally grid");

    // Place loaded collector at depot unload point and clear enemy to isolate team econ.
    let col = game
        .units
        .iter_mut()
        .find(|u| u.team == Team::Player && u.kind == UnitKind::Collector)
        .unwrap();
    col.x = ux;
    col.z = uz;
    col.cargo = 100.0;
    col.unload_progress = 0.0;

    // 1.5s dump duration (30 steps at 0.05s). Stop enemy AI and check just after completion.
    game.credits = 0.0;
    let passive = game.game_mode.passive_income();
    step_secs(&mut game, 1.55);
    let depot = game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .unwrap();
    assert!(depot.stored_ore > 95.0, "expected full load dumped in 1.5s, got {}", depot.stored_ore);

    // Measure 4.0s of pure conveyor streaming (exclude passive income & stop collector from mining second load).
    game.units.retain(|u| u.kind != UnitKind::Collector);
    let start_ore = game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .unwrap()
        .stored_ore;
    let start_credits = game.credits;
    step_secs(&mut game, 4.0);
    let end_ore = game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .unwrap()
        .stored_ore;
    let drained = start_ore - end_ore;
    assert!((drained - ORE_DEPOT_RATE * 4.0).abs() < 0.05, "expected 50 ore drained, got {drained}");
    let earned_above_passive = (game.credits - start_credits) - passive * 4.0;
    assert!(
        (earned_above_passive - ORE_DEPOT_RATE * 4.0).abs() < 0.05,
        "expected 50 credits streamed above passive income, got {earned_above_passive}"
    );
}

#[test]
fn battle_damage_slows_conveyor_at_damaged_and_critical_marks() {
    for (hp, expected_rate) in [
        (ORE_DEPOT_HEALTH, ORE_DEPOT_RATE),
        (ORE_DEPOT_HEALTH * DAMAGED_HEALTH, ORE_DEPOT_RATE * 0.75),
        (ORE_DEPOT_HEALTH * CRITICAL_HEALTH, ORE_DEPOT_RATE * 0.5),
    ] {
        let mut game = quiet_game();
        game.credits = 500.0;
        game.spawn(Team::Player, UnitKind::Collector);
        game.build_pad("ore_depot");
        let depot = game
            .buildings
            .iter_mut()
            .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
            .unwrap();
        depot.construction_remaining = 0.0;
        depot.hp = hp;
        depot.stored_ore = 100.0;
        assert!((depot.conveyor_rate() - expected_rate).abs() < 1e-4);

        game.units.clear();
        step_secs(&mut game, 2.0);
        let remaining = game
            .buildings
            .iter()
            .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
            .unwrap()
            .stored_ore;
        let drained = 100.0 - remaining;
        assert!(
            (drained - expected_rate * 2.0).abs() < 0.05,
            "hp={hp}: expected drain {}, got {drained}",
            expected_rate * 2.0
        );
    }
}

#[test]
fn conveyor_pauses_at_credit_cap_and_freezes_when_refinery_is_lost() {
    let mut game = quiet_game();
    game.credits = 500.0;
    game.spawn(Team::Player, UnitKind::Collector);
    game.build_pad("ore_depot");
    let depot_id = {
        let d = game
            .buildings
            .iter_mut()
            .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
            .unwrap();
        d.construction_remaining = 0.0;
        d.stored_ore = 100.0;
        d.id
    };
    game.units.clear();

    // Pause cleanly at CREDIT_CAP with zero ore loss.
    game.credits = CREDIT_CAP;
    step_secs(&mut game, 3.0);
    assert_eq!(game.credits, CREDIT_CAP);
    assert_eq!(
        game.buildings.iter().find(|b| b.id == depot_id).unwrap().stored_ore,
        100.0
    );

    // Freeze when Refinery is lost.
    game.credits = 100.0;
    let saved_refinery = game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::Refinery)
        .unwrap()
        .clone();
    game.buildings
        .retain(|b| b.team != Team::Player || b.kind != BuildingKind::Refinery);
    step_secs(&mut game, 3.0);
    assert_eq!(
        game.buildings.iter().find(|b| b.id == depot_id).unwrap().stored_ore,
        100.0
    );

    // Resumes when Refinery returns.
    game.buildings.push(saved_refinery);
    step_secs(&mut game, 2.0);
    assert!(
        (game.buildings.iter().find(|b| b.id == depot_id).unwrap().stored_ore - 75.0).abs() < 0.05
    );
}

#[test]
fn depot_destruction_loses_stored_ore_while_mid_dump_preserves_collector_cargo() {
    let mut game = quiet_game();
    game.credits = 500.0;
    game.spawn(Team::Player, UnitKind::Collector);
    game.build_pad("ore_depot");
    let depot = game
        .buildings
        .iter_mut()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .unwrap();
    depot.construction_remaining = 0.0;
    depot.stored_ore = 150.0;
    let depot_id = depot.id;
    let (ux, uz) = depot_unload_point(depot);

    let col = game
        .units
        .iter_mut()
        .find(|u| u.team == Team::Player && u.kind == UnitKind::Collector)
        .unwrap();
    col.x = ux;
    col.z = uz;
    col.cargo = 100.0;
    col.unload_progress = 0.4;
    col.unload_target = Some(depot_id);

    game.credits = 0.0;
    game.buildings.iter_mut().find(|b| b.id == depot_id).unwrap().hp = 0.0;
    game.update(0.05);

    // Depot and its 150 unconveyed ore are lost.
    assert!(!game.buildings.iter().any(|b| b.id == depot_id));
    assert!(game.credits < 5.0, "lost stored_ore must not be credited");

    // Collector keeps its 100 cargo, exits unload, and completes delivery at Refinery.
    let col = game
        .units
        .iter()
        .find(|u| u.team == Team::Player && u.kind == UnitKind::Collector)
        .unwrap();
    assert_eq!(col.cargo, 100.0);
    assert_eq!(col.unload_progress, 0.0);

    step_secs(&mut game, 12.0);
    assert!(game.credits > 100.0, "rerouted collector should deliver to refinery");
}

#[test]
fn hopper_capacity_overflow_routes_to_refinery_without_flank_ping_pong() {
    let mut game = quiet_game();
    game.credits = 500.0;
    game.spawn(Team::Player, UnitKind::Collector);
    game.build_pad("ore_depot");
    let depot_idx = game
        .buildings
        .iter()
        .position(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
        .unwrap();
    game.buildings[depot_idx].construction_remaining = 0.0;
    // Almost full depot leaves no room for a full 100-cargo load.
    game.buildings[depot_idx].stored_ore = 150.0;
    let depot_id = game.buildings[depot_idx].id;

    let col_id = game.units[0].id;
    {
        let col = &mut game.units[0];
        col.cargo = 100.0;
        // Empty deposit assignment, should pick Refinery instead of full Depot.
        col.x = 7.0;
        col.z = 26.0;
    }
    game.update(0.05);
    let col = game.units.iter().find(|u| u.id == col_id).unwrap();
    assert_ne!(col.unload_target, Some(depot_id), "full depot must not accept overflow collector");

    // choose_deposit must not change score when stored_ore fluctuates (prevents flank ping-pong).
    let refinery = game
        .buildings
        .iter()
        .find(|b| b.team == Team::Player && b.kind == BuildingKind::Refinery)
        .unwrap()
        .clone();
    game.units[0].cargo = 0.0;
    game.units[0].deposit = None;
    let chosen_full = {
        game.buildings.iter_mut().find(|b| b.id == depot_id).unwrap().stored_ore = 190.0;
        choose_deposit(&game.ore, &game.units[0], &refinery, &game.units, &game.buildings, None)
    };
    let chosen_empty = {
        game.buildings.iter_mut().find(|b| b.id == depot_id).unwrap().stored_ore = 0.0;
        choose_deposit(&game.ore, &game.units[0], &refinery, &game.units, &game.buildings, None)
    };
    assert_eq!(chosen_full, chosen_empty);

    // Two collectors sharing one Depot never overflow stored_ore past capacity (200)
    // and stream steady bounded income without stalled cargo.
    game.spawn(Team::Player, UnitKind::Collector);
    game.credits = 0.0;
    game.buildings.iter_mut().find(|b| b.id == depot_id).unwrap().stored_ore = 0.0;
    step_secs(&mut game, 40.0);
    let depot = game.buildings.iter().find(|b| b.id == depot_id).unwrap();
    assert!(depot.stored_ore <= ORE_DEPOT_CAPACITY + 1e-3);
    assert!(game.credits > game.game_mode.passive_income() * 40.0 + 150.0);
}

#[test]
fn rifles_deal_double_damage_and_demo_truck_values_eta_discounted_ore() {
    let mut game = quiet_game();
    game.credits = 500.0;
    game.spawn(Team::Player, UnitKind::Collector);
    game.build_pad("ore_depot");
    let (id, depot_x) = {
        let b = game
            .buildings
            .iter()
            .find(|b| b.team == Team::Player && b.kind == BuildingKind::OreDepot)
            .unwrap();
        (b.id, b.x)
    };
    game.spawn(Team::Enemy, UnitKind::Soldier);
    let rifle = game.units.last_mut().unwrap();
    rifle.x = depot_x;
    rifle.z = 28.0;
    rifle.cooldown = 0.0;
    rifle.state = UnitState::Attack;
    game.combat_and_move(0.05);
    let depot = game.buildings.iter().find(|b| b.id == id).unwrap();
    assert_eq!(depot.hp, ORE_DEPOT_HEALTH - 24.0, "rifles deal 2x pad damage");

    // Demo Truck valuation:
    // 1) Close strike: prioritizes brimming OreDepot (220 + 200 = 420) over empty OreDepot (220).
    let mut truck_game = quiet_game();
    truck_game
        .buildings
        .retain(|b| b.kind != BuildingKind::Command && b.kind != BuildingKind::Refinery);
    truck_game.buildings.push(Building {
        id: 500,
        team: Team::Player,
        kind: BuildingKind::Command,
        x: 0.0,
        z: 45.0,
        hp: 1500.0,
        max_hp: 1500.0,
        cooldown: 0.0,
        facing: 0.0,
        defense_slot: None,
        construction_time: 0.0,
        construction_remaining: 0.0,
        stored_ore: 0.0,
    });
    truck_game.buildings.push(Building {
        id: 501,
        team: Team::Enemy,
        kind: BuildingKind::OreDepot,
        x: -7.0,
        z: -34.0,
        hp: ORE_DEPOT_HEALTH,
        max_hp: ORE_DEPOT_HEALTH,
        cooldown: 0.0,
        facing: 0.0,
        defense_slot: Some(0),
        construction_time: 0.0,
        construction_remaining: 0.0,
        stored_ore: 0.0,
    });
    truck_game.buildings.push(Building {
        id: 502,
        team: Team::Enemy,
        kind: BuildingKind::OreDepot,
        x: 7.0,
        z: -34.0,
        hp: ORE_DEPOT_HEALTH,
        max_hp: ORE_DEPOT_HEALTH,
        cooldown: 0.0,
        facing: 0.0,
        defense_slot: Some(1),
        construction_time: 0.0,
        construction_remaining: 0.0,
        stored_ore: 200.0,
    });
    truck_game.spawn(Team::Player, UnitKind::Demolition);
    let truck = truck_game.units.last_mut().unwrap();
    truck.x = 0.0;
    truck.z = -12.0;
    truck.state = UnitState::Attack;
    truck_game.ai_decision_timer = f32::INFINITY;
    step_secs(&mut truck_game, 3.5);
    assert!(
        !truck_game.buildings.iter().any(|b| b.id == 502),
        "demolition truck must prioritize the brimming ore depot (502)"
    );
    assert!(
        truck_game.buildings.iter().any(|b| b.id == 501),
        "empty ore depot (501) should be left standing"
    );

    // 2) ETA discount: OreDepot with 60 stored_ore vs Emplacement (200) + 1 Soldier (60) = 260.
    // Close (eta ~ 1s): 220 + (60 - 12.5*1) = 267.5 > 260 -> strikes Depot.
    // Far (eta ~ 5s): 220 + max(0, 60 - 12.5*5) = 220 < 260 -> prefers Emplacement + Soldier.
    for (start_z, expect_depot_dead) in [(-24.0_f32, true), (25.0_f32, false)] {
        let mut g = quiet_game();
        g.buildings.clear();
        g.buildings.push(Building {
            id: 600,
            team: Team::Player,
            kind: BuildingKind::Command,
            x: 0.0,
            z: 45.0,
            hp: 1500.0,
            max_hp: 1500.0,
            cooldown: 0.0,
            facing: 0.0,
            defense_slot: None,
            construction_time: 0.0,
            construction_remaining: 0.0,
            stored_ore: 0.0,
        });
        g.buildings.push(Building {
            id: 601,
            team: Team::Enemy,
            kind: BuildingKind::OreDepot,
            x: -10.0,
            z: -34.0,
            hp: ORE_DEPOT_HEALTH,
            max_hp: ORE_DEPOT_HEALTH,
            cooldown: 0.0,
            facing: 0.0,
            defense_slot: Some(0),
            construction_time: 0.0,
            construction_remaining: 0.0,
            stored_ore: 60.0,
        });
        g.buildings.push(Building {
            id: 602,
            team: Team::Enemy,
            kind: BuildingKind::Emplacement,
            x: 10.0,
            z: -34.0,
            hp: EMPLACEMENT_HEALTH,
            max_hp: EMPLACEMENT_HEALTH,
            cooldown: 0.0,
            facing: 0.0,
            defense_slot: Some(1),
            construction_time: 0.0,
            construction_remaining: 0.0,
            stored_ore: 0.0,
        });
        g.spawn(Team::Enemy, UnitKind::Soldier);
        let guard = g.units.last_mut().unwrap();
        guard.x = 10.0;
        guard.z = -31.5;
        g.spawn(Team::Player, UnitKind::Demolition);
        let truck = g.units.last_mut().unwrap();
        truck.x = 0.0;
        truck.z = start_z;
        truck.state = UnitState::Attack;
        step_secs(&mut g, if expect_depot_dead { 2.5 } else { 8.0 });
        assert_eq!(
            !g.buildings.iter().any(|b| b.id == 601),
            expect_depot_dead,
            "start_z={start_z} ETA discount should switch target"
        );
    }
}

#[test]
fn hard_standard_completes_base_under_early_pressure_and_uses_depots() {
    // Regression for Hard seeds 3 & 9 (DepotBoom vs BarracksPressure): both sides finish all 3 sites.
    for seed in [3, 9] {
        let mut game = Game::demo_with_options(seed, Difficulty::Hard, GameMode::Standard);
        step_secs(&mut game, 120.0);
        for team in [Team::Player, Team::Enemy] {
            for kind in BuildingKind::SITE_STRUCTURES {
                assert!(
                    game.buildings.iter().any(|b| b.team == team && b.kind == kind),
                    "seed {seed} {team:?} should start/finish {kind:?} within 120s"
                );
            }
        }
    }

    // Verify Hard builds Forward Ore Depots across Deathmatch/Standard matches fairly.
    let mut built_depot = false;
    for seed in 0..8 {
        let mut game = Game::demo_with_options(seed, Difficulty::Hard, GameMode::Standard);
        for _ in 0..2400 {
            game.update(0.05);
            if game.buildings.iter().any(|b| b.kind == BuildingKind::OreDepot) {
                built_depot = true;
                break;
            }
        }
        if built_depot {
            break;
        }
    }
    assert!(built_depot, "Hard AI should construct Forward Ore Depots when appropriate");
}

fn deathmatch_depot_test_game(difficulty: Difficulty) -> Game {
    let mut game = Game::with_difficulty(42, difficulty);
    game.units.clear();
    game.ai_decision_timer = f32::INFINITY;
    game.ai_credits = 300.0;
    for _ in 0..2 {
        game.spawn(Team::Enemy, UnitKind::Collector);
    }
    for _ in 0..3 {
        game.spawn(Team::Enemy, UnitKind::Tank);
    }
    game
}

#[test]
fn hard_ai_ore_depot_respects_safety_ore_and_deathmatch_surplus() {
    let mut g = deathmatch_depot_test_game(Difficulty::Hard);
    g.enemy_factory_queue.push(UnitKind::Tank);
    g.enemy_barracks_queue.push(UnitKind::Soldier);
    assert!(g.should_buy_ore_depot(Team::Enemy));
    g.prepare_ore_depot(Team::Enemy);
    assert!(
        g.buildings
            .iter()
            .any(|b| b.team == Team::Enemy && b.kind == BuildingKind::OreDepot),
        "Hard AI should spend Deathmatch overflow on an Ore Depot when both queues are busy"
    );
    assert!((g.ai_credits - (300.0 - ORE_DEPOT_COST)).abs() < 1e-4);

    // Pad / base threat rejects depot construction even with overflow credits.
    let mut threatened = deathmatch_depot_test_game(Difficulty::Hard);
    threatened.enemy_factory_queue.push(UnitKind::Tank);
    threatened.enemy_barracks_queue.push(UnitKind::Soldier);
    threatened.spawn(Team::Player, UnitKind::Soldier);
    let scout = threatened.units.last_mut().unwrap();
    scout.x = 7.0;
    scout.z = -20.0;
    assert!(!threatened.should_buy_ore_depot(Team::Enemy));

    // Scarce own-half ore rejects depot construction.
    let mut scarce = deathmatch_depot_test_game(Difficulty::Hard);
    scarce.enemy_factory_queue.push(UnitKind::Tank);
    scarce.enemy_barracks_queue.push(UnitKind::Soldier);
    for ore in &mut scarce.ore {
        if ore.z < -5.0 {
            ore.amount = 100.0;
        }
    }
    assert!(!scarce.should_buy_ore_depot(Team::Enemy));

    // Exact 220 credits (without post-buy buffer) or idle production queue refuses DM depot.
    let mut tight_credits = deathmatch_depot_test_game(Difficulty::Hard);
    tight_credits.enemy_factory_queue.push(UnitKind::Tank);
    tight_credits.enemy_barracks_queue.push(UnitKind::Soldier);
    tight_credits.ai_credits = ORE_DEPOT_COST;
    assert!(!tight_credits.should_buy_ore_depot(Team::Enemy));

    let mut idle_factory = deathmatch_depot_test_game(Difficulty::Hard);
    idle_factory.enemy_barracks_queue.push(UnitKind::Soldier);
    assert!(!idle_factory.should_buy_ore_depot(Team::Enemy));
}

#[test]
fn medium_ai_builds_ore_depot_in_standard_and_when_ahead_in_deathmatch() {
    let mut std_mirror = Game::demo_with_options(3, Difficulty::Medium, GameMode::Standard);
    step_secs(&mut std_mirror, 60.0);
    for team in [Team::Player, Team::Enemy] {
        assert!(
            std_mirror
                .buildings
                .iter()
                .any(|b| b.team == team && b.kind == BuildingKind::OreDepot),
            "Standard Medium mirror should construct an Ore Depot symmetrically for {team:?}"
        );
    }

    let mut ahead = deathmatch_depot_test_game(Difficulty::Medium);
    assert!(ahead.should_buy_ore_depot(Team::Enemy));
    ahead.prepare_ore_depot(Team::Enemy);
    assert!(ahead
        .buildings
        .iter()
        .any(|b| b.team == Team::Enemy && b.kind == BuildingKind::OreDepot));

    let mut threatened = deathmatch_depot_test_game(Difficulty::Medium);
    threatened.spawn(Team::Player, UnitKind::Soldier);
    let scout = threatened.units.last_mut().unwrap();
    scout.x = 7.0;
    scout.z = -20.0;
    assert!(!threatened.should_buy_ore_depot(Team::Enemy));

    let mut behind = deathmatch_depot_test_game(Difficulty::Medium);
    for _ in 0..4 {
        behind.spawn(Team::Player, UnitKind::Tank);
        let tank = behind.units.last_mut().unwrap();
        tank.x = 0.0;
        tank.z = 25.0;
    }
    assert!(!behind.should_buy_ore_depot(Team::Enemy));
}
