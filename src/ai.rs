//! Difficulty changes decisions only. All orders use the normal production and
//! deployment paths; combat, movement, mining and income are shared with players.
use super::*;

const COMBAT_KINDS: [UnitKind; 3] = [UnitKind::Soldier, UnitKind::Rocket, UnitKind::Tank];

#[derive(Clone, Default)]
struct Force {
    count: [f32; 3],
    health: f32,
}

impl Force {
    fn add(&mut self, kind: UnitKind, hp: f32) {
        if let Some(i) = COMBAT_KINDS.iter().position(|&k| k == kind) {
            // Wounded units still fire at full speed until killed, but contribute
            // less staying power. Trucks are handled as a separate blast threat.
            self.count[i] += 1.0;
            self.health += hp;
        }
    }

    fn power_against(&self, other: &Self) -> f32 {
        let total: f32 = other.count.iter().sum();
        let dps: f32 = COMBAT_KINDS
            .iter()
            .enumerate()
            .map(|(i, &kind)| {
                let damage = if total > 0.0 {
                    COMBAT_KINDS
                        .iter()
                        .enumerate()
                        .map(|(j, &target)| kind.damage(Some(target)) * other.count[j] / total)
                        .sum()
                } else {
                    kind.damage(None)
                };
                // Range matters when closing on a firing line.
                self.count[i] * damage / kind.interval() * (kind.range() / 7.0).sqrt()
            })
            .sum();
        (self.health * dps).sqrt()
    }
}

impl Game {
    pub(super) fn ai_easy(&mut self, team: Team) {
        let wave = if team == Team::Enemy {
            self.ai_wave_timer
        } else {
            self.demo_wave_timer
        };
        // A slow, predictable commander: no counter-picking, one collector, and
        // small waves with long recovery windows. Its troops still fight normally.
        if wave <= -13.0 {
            for u in self
                .units
                .iter_mut()
                .filter(|u| {
                    u.team == team && u.kind != UnitKind::Collector && u.state == UnitState::Gather
                })
                .take(3)
            {
                u.state = UnitState::Attack;
            }
            if team == Team::Enemy {
                self.ai_wave_timer = 11.0;
            } else {
                self.demo_wave_timer = 11.0;
            }
        }
        let collectors = self
            .units
            .iter()
            .filter(|u| u.team == team && u.kind == UnitKind::Collector && u.hp > 0.0)
            .count();
        if self.time >= 24.0
            && collectors == 0
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
        {
            self.queue_unit(team, UnitKind::Collector);
        } else if self.time >= 50.0
            && (self.time as u32 / 4).is_multiple_of(3)
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
        {
            self.queue_unit(team, UnitKind::Tank);
        }
        if self
            .production_queue(team, BuildingKind::Barracks)
            .is_empty()
        {
            let kind = if (self.time as u32 / 4) % 4 == 3 {
                UnitKind::Rocket
            } else {
                UnitKind::Soldier
            };
            self.queue_unit(team, kind);
        }
        if team == Team::Enemy {
            self.ai_status = "PREPARING A SMALL PATROL".into();
        }
    }

    pub(super) fn ai_hard(&mut self, team: Team) {
        let direction = if team == Team::Enemy { 1.0 } else { -1.0 };
        let mut opposing = Force::default();
        let mut incoming = Force::default();
        let mut own = Force::default();
        let mut local = Force::default();
        let mut reserves = 0;
        let mut collectors = 0;
        let mut trucks = 0;
        let mut incoming_trucks = 0;
        for u in self.units.iter().filter(|u| u.hp > 0.0) {
            if u.team == team {
                own.add(u.kind, u.hp);
                if u.z * direction < 5.0 {
                    local.add(u.kind, u.hp);
                }
                if u.kind == UnitKind::Collector {
                    collectors += 1;
                } else if matches!(u.state, UnitState::Gather | UnitState::Garrison) {
                    reserves += 1;
                }
            } else if u.on_field() {
                opposing.add(u.kind, u.hp);
                if u.z * direction < -5.0 {
                    incoming.add(u.kind, u.hp);
                }
                if u.kind == UnitKind::Demolition {
                    trucks += 1;
                    if u.z * direction < -5.0 {
                        incoming_trucks += 1;
                    }
                }
            }
        }
        let pressure = incoming.power_against(&local);
        let defense = local.power_against(&incoming);
        let threatened = pressure > 0.0 || incoming_trucks > 0;
        let retreating = self.team_mode(team) == Mode::Retreat;
        let can_rebuild = self.alive_building(team, BuildingKind::Barracks)
            || self.alive_building(team, BuildingKind::Factory);
        let retreat =
            can_rebuild && threatened && pressure > defense * if retreating { 1.0 } else { 1.3 };
        if retreat && !retreating {
            self.set_team_mode(team, Mode::Retreat);
        } else if retreating && !retreat {
            self.set_team_mode(team, Mode::Gather);
        }

        let wave = if team == Team::Enemy {
            self.ai_wave_timer
        } else {
            self.demo_wave_timer
        };
        let advantage = own.power_against(&opposing) > opposing.power_against(&own) * 1.12;
        let launch = !retreat
            && reserves > 0
            && (threatened
                || !can_rebuild
                || (wave <= 0.0
                    && ((advantage && reserves >= 4)
                        || reserves >= 10
                        || (wave < -25.0 && reserves >= 6))));
        if launch {
            // Commit a group together instead of sending isolated reinforcements
            // into a superior force. This is the same selection order players use.
            for u in &mut self.units {
                if u.team == team && u.kind != UnitKind::Collector && u.state == UnitState::Gather {
                    u.state = UnitState::Attack;
                }
            }
            if team == Team::Enemy {
                self.ai_wave_timer = 6.0;
            } else {
                self.demo_wave_timer = 6.0;
            }
        }

        // Only count our own queues. No decisions inspect opposing production,
        // garrisons, credits, cooldowns, commands, or future random values.
        for &kind in self
            .production_queue(team, BuildingKind::Barracks)
            .iter()
            .chain(self.production_queue(team, BuildingKind::Factory))
        {
            own.add(kind, kind.health());
            if kind == UnitKind::Collector {
                collectors += 1;
            }
        }

        // Expand only while safe and while nearby ore can repay the investment.
        // Avoid tying the factory up with harvesters during a base assault.
        let safe_ore: f32 = self
            .ore
            .iter()
            .filter(|o| o.z * direction < -5.0)
            .map(|o| o.amount)
            .sum();
        let collector_goal = if self.time < 18.0 { 2 } else { 3 };
        let expand = !threatened
            && collectors < collector_goal
            && safe_ore > (collectors + 1) as f32 * 350.0
            && self.alive_building(team, BuildingKind::Refinery)
            && self.alive_building(team, BuildingKind::Factory)
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty();
        if expand {
            self.queue_unit(team, UnitKind::Collector);
            if self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
            {
                return; // Save the actual purchase price, without free credit.
            }
        }

        // Rank marginal combat value per credit against the visible matchup.
        // Re-evaluate after each purchase so both queues complement each other.
        for _ in 0..2 {
            let base_power = own.power_against(&opposing);
            let best = COMBAT_KINDS
                .iter()
                .copied()
                .filter(|kind| {
                    self.alive_building(team, kind.production_building())
                        && self
                            .production_queue(team, kind.production_building())
                            .is_empty()
                })
                .map(|kind| {
                    let mut projected = own.clone();
                    projected.add(kind, kind.health());
                    let mut value = (projected.power_against(&opposing) - base_power) / kind.cost();
                    // Keep enough ranged anti-vehicle fire to stop visible trucks.
                    if kind == UnitKind::Rocket && own.count[1] < trucks as f32 * 2.0 {
                        value *= 2.5;
                    }
                    (kind, value)
                })
                .max_by(|a, b| a.1.total_cmp(&b.1));
            let Some((kind, _)) = best else {
                break;
            };
            let credits = if team == Team::Enemy {
                self.ai_credits
            } else {
                self.credits
            };
            if credits < kind.cost() {
                break; // Save for the counter instead of buying a weaker unit.
            }
            self.queue_unit(team, kind);
            own.add(kind, kind.health());
        }
        if team == Team::Enemy {
            self.ai_status = if retreat {
                "PRESERVING FORCES AND REGROUPING"
            } else if threatened {
                "REINFORCING LOCAL DEFENSE"
            } else if expand {
                "EXPANDING ORE INCOME"
            } else if launch {
                "COMMITTING A COORDINATED ASSAULT"
            } else {
                "PLANNING THE NEXT COUNTER"
            }
            .into();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIFFICULTIES: [Difficulty; 3] = [Difficulty::Easy, Difficulty::Medium, Difficulty::Hard];

    #[test]
    fn medium_is_the_default_and_unknown_difficulties_fall_back_to_it() {
        assert_eq!(Game::new().difficulty, Difficulty::Medium);
        assert_eq!(Game::demo_with_seed(5).difficulty, Difficulty::Medium);
        assert_eq!(Difficulty::parse("invalid"), Difficulty::Medium);
        for (name, expected) in [
            ("easy", Difficulty::Easy),
            ("medium", Difficulty::Medium),
            ("hard", Difficulty::Hard),
        ] {
            assert_eq!(Difficulty::parse(name), expected);
        }
    }

    #[test]
    fn every_difficulty_has_equal_starting_resources_income_and_caps() {
        for difficulty in DIFFICULTIES {
            for demo in [false, true] {
                let mut g = if demo {
                    Game::demo_with_difficulty(5, difficulty)
                } else {
                    Game::with_difficulty(5, difficulty)
                };
                assert_eq!(g.credits, 500.0);
                assert_eq!(g.ai_credits, g.credits);
                g.ai_decision_timer = f32::INFINITY;
                g.update(0.25);
                assert!((g.credits - 506.0).abs() < 0.001);
                assert_eq!(g.credits, g.ai_credits);
                g.credits = 1999.0;
                g.ai_credits = 1999.0;
                g.update(0.25);
                assert_eq!(g.credits, 2000.0);
                assert_eq!(g.ai_credits, g.credits);
            }
        }
    }

    fn orders(g: &Game, team: Team) -> (Vec<UnitKind>, Vec<UnitKind>, Mode, Vec<UnitState>) {
        (
            g.production_queue(team, BuildingKind::Barracks).to_vec(),
            g.production_queue(team, BuildingKind::Factory).to_vec(),
            g.team_mode(team),
            g.units
                .iter()
                .filter(|u| u.team == team)
                .map(|u| u.state)
                .collect(),
        )
    }

    #[test]
    fn decisions_do_not_change_when_private_opponent_information_changes() {
        for difficulty in DIFFICULTIES {
            for team in [Team::Player, Team::Enemy] {
                let mut baseline = Game::with_difficulty(26, difficulty);
                let mut hidden = Game::with_difficulty(26, difficulty);
                let opponent = if team == Team::Player {
                    Team::Enemy
                } else {
                    Team::Player
                };
                // Change queues, money and protected garrisons without changing
                // anything the commander can see on the open battlefield.
                if opponent == Team::Player {
                    hidden.factory_queue = vec![UnitKind::Tank; 8];
                    hidden.barracks_queue = vec![UnitKind::Rocket; 8];
                    hidden.credits = 0.0;
                } else {
                    hidden.enemy_factory_queue = vec![UnitKind::Tank; 8];
                    hidden.enemy_barracks_queue = vec![UnitKind::Rocket; 8];
                    hidden.ai_credits = 0.0;
                }
                hidden.set_team_mode(opponent, Mode::Retreat);
                for _ in 0..8 {
                    hidden.spawn(opponent, UnitKind::Rocket);
                }
                hidden.spawn(opponent, UnitKind::Demolition);
                baseline.time = 40.0;
                hidden.time = 40.0;
                baseline.ai_decide_for(team);
                hidden.ai_decide_for(team);
                assert_eq!(
                    orders(&baseline, team),
                    orders(&hidden, team),
                    "{difficulty:?} {team:?}"
                );
            }
        }
    }

    #[test]
    fn ai_orders_obey_money_buildings_queue_limits_and_demolition_limit() {
        for difficulty in DIFFICULTIES {
            let mut g = Game::with_difficulty(5, difficulty);
            g.ai_credits = 59.0;
            g.queue_unit(Team::Enemy, UnitKind::Soldier);
            assert_eq!(g.ai_credits, 59.0);
            assert!(g.enemy_barracks_queue.is_empty());
            g.ai_credits = 2000.0;
            for _ in 0..10 {
                g.queue_unit(Team::Enemy, UnitKind::Soldier);
            }
            assert_eq!(g.enemy_barracks_queue.len(), QUEUE_LIMIT);
            assert_eq!(g.ai_credits, 2000.0 - 60.0 * QUEUE_LIMIT as f32);
            g.queue_unit(Team::Enemy, UnitKind::Demolition);
            g.queue_unit(Team::Enemy, UnitKind::Demolition);
            assert_eq!(g.enemy_factory_queue, vec![UnitKind::Demolition]);
            g.enemy_factory_queue.clear();
            g.buildings
                .retain(|b| b.team != Team::Enemy || b.kind == BuildingKind::Command);
            let credits = g.ai_credits;
            for kind in [UnitKind::Collector, UnitKind::Tank, UnitKind::Demolition] {
                g.queue_unit(Team::Enemy, kind);
            }
            assert!(g.enemy_factory_queue.is_empty());
            assert_eq!(g.ai_credits, credits);
        }
    }

    #[test]
    fn hard_counters_visible_armor_and_protects_its_economy_under_pressure() {
        let mut g = Game::with_difficulty(5, Difficulty::Hard);
        g.time = 40.0;
        for _ in 0..6 {
            g.spawn(Team::Player, UnitKind::Tank);
        }
        for u in g.units.iter_mut().filter(|u| u.team == Team::Player) {
            u.z = -15.0;
        }
        g.ai_decide();
        assert_eq!(g.enemy_barracks_queue.first(), Some(&UnitKind::Rocket));
        assert!(!g.enemy_factory_queue.contains(&UnitKind::Collector));
        assert_eq!(g.enemy_mode, Mode::Retreat);
        for u in g.units.iter_mut().filter(|u| u.team == Team::Player) {
            u.z = 30.0;
        }
        g.ai_credits = 500.0;
        g.enemy_factory_queue.clear();
        g.ai_decide();
        assert_eq!(g.enemy_mode, Mode::Gather);
        assert_eq!(g.enemy_factory_queue.first(), Some(&UnitKind::Collector));
    }

    #[test]
    fn hard_beats_lower_difficulties_across_seeds_and_starting_sides() {
        for weaker in [Difficulty::Easy, Difficulty::Medium] {
            let mut wins = 0;
            for seed in [5, 26, 1941] {
                for hard_team in [Team::Player, Team::Enemy] {
                    let mut g = Game::demo_with_seed(seed);
                    g.ai_decision_timer = f32::INFINITY;
                    let mut timers = [0.0f32; 2];
                    for _ in 0..1200 {
                        for (i, team) in [Team::Player, Team::Enemy].into_iter().enumerate() {
                            let difficulty = if team == hard_team {
                                Difficulty::Hard
                            } else {
                                weaker
                            };
                            timers[i] -= 0.25;
                            if timers[i] <= 0.0 {
                                g.difficulty = difficulty;
                                g.ai_decide_for(team);
                                timers[i] = difficulty.decision_interval();
                            }
                        }
                        g.update(0.25);
                        if g.outcome != Outcome::Playing {
                            break;
                        }
                    }
                    let won = g.outcome
                        == if hard_team == Team::Player {
                            Outcome::Victory
                        } else {
                            Outcome::Defeat
                        };
                    if won {
                        wins += 1;
                    }
                    eprintln!(
                        "Hard {hard_team:?} vs {weaker:?}, seed {seed}: {:?} at {:.0}s",
                        g.outcome, g.time
                    );
                }
            }
            eprintln!("Hard wins against {weaker:?}: {wins}/6");
            assert!(
                wins >= 5,
                "Hard should consistently beat {weaker:?}; won {wins}/6"
            );
        }
    }

    #[test]
    fn easy_is_beatable_with_a_simple_mixed_army_and_attack_order() {
        for seed in [5, 26, 1941] {
            let mut g = Game::with_difficulty(seed, Difficulty::Easy);
            for tick in 0..1000 {
                if tick % 20 == 0 {
                    g.train("soldier");
                }
                if tick % 60 == 0 {
                    g.train("rocket");
                }
                if tick % 48 == 0 {
                    g.train("tank");
                }
                if tick == 80 {
                    g.set_mode("attack");
                }
                g.update(0.25);
                if g.outcome != Outcome::Playing {
                    break;
                }
            }
            assert_eq!(g.outcome, Outcome::Victory, "seed {seed}, time {}", g.time);
        }
    }

    #[test]
    fn ai_and_human_units_take_the_same_time_and_have_the_same_stats() {
        for difficulty in DIFFICULTIES {
            for kind in [
                UnitKind::Soldier,
                UnitKind::Rocket,
                UnitKind::Tank,
                UnitKind::Demolition,
                UnitKind::Collector,
            ] {
                let mut g = Game::with_difficulty(5, difficulty);
                g.units.clear();
                g.ai_decision_timer = f32::INFINITY;
                g.queue_unit(Team::Player, kind);
                g.queue_unit(Team::Enemy, kind);
                for _ in 0..((kind.build_time() / 0.05) as usize - 1) {
                    g.update(0.05);
                }
                assert!(
                    g.units.is_empty(),
                    "no early completion: {difficulty:?} {kind:?}"
                );
                g.update(0.1);
                assert_eq!(g.units.len(), 2);
                for u in &g.units {
                    assert_eq!(u.hp, kind.health());
                    assert_eq!(u.max_hp, kind.health());
                    assert_eq!(u.kind, kind);
                }
                assert_eq!(g.credits, g.ai_credits);
            }
        }
    }
}
