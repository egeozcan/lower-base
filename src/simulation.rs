use serde::Serialize;

#[path = "ai.rs"]
mod ai;
#[cfg(any(test, feature = "ai-bench"))]
#[path = "ai_benchmark.rs"]
pub mod ai_benchmark;
#[cfg(any(test, feature = "ai-bench"))]
#[path = "balance_benchmark.rs"]
pub mod balance_benchmark;
#[path = "navigation.rs"]
mod navigation;
#[cfg(any(test, feature = "ai-bench"))]
#[path = "stock_hard.rs"]
mod stock_hard;

const FIELD_EDGE: f32 = 17.0;
const QUEUE_LIMIT: usize = 9;
const COLLECTOR_CAPACITY: f32 = 100.0;
const MINING_RATE: f32 = 25.0;
const STARTING_CREDITS: f32 = 500.0;
const PASSIVE_INCOME: f32 = 24.0;
const CREDIT_CAP: f32 = 2000.0;
// A costly, fragile breaching tool: lethal to clustered infantry, but a tank
// survives a blast beyond close range and no full-health structure is one-shot.
const DEMOLITION_RADIUS: f32 = 7.0;
const DEMOLITION_DAMAGE: f32 = 450.0;
const DEMOLITION_CORE: f32 = 2.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Team {
    Player,
    Enemy,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Difficulty {
    Easy,
    #[default]
    Medium,
    Hard,
}

impl Difficulty {
    pub fn parse(value: &str) -> Self {
        match value {
            "easy" => Self::Easy,
            "hard" => Self::Hard,
            _ => Self::Medium,
        }
    }

    fn decision_interval(self) -> f32 {
        match self {
            Self::Easy => 4.0,
            Self::Medium => 1.0,
            Self::Hard => 0.5,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UnitKind {
    Soldier,
    Rocket,
    Tank,
    Demolition,
    Collector,
}

impl UnitKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "soldier" => Some(Self::Soldier),
            "rocket" => Some(Self::Rocket),
            "tank" => Some(Self::Tank),
            "demolition" => Some(Self::Demolition),
            "collector" => Some(Self::Collector),
            _ => None,
        }
    }
    fn cost(self) -> f32 {
        match self {
            Self::Soldier => 60.0,
            Self::Rocket => 90.0,
            Self::Tank => 150.0,
            Self::Demolition => 250.0,
            Self::Collector => 200.0,
        }
    }
    fn build_time(self) -> f32 {
        match self {
            Self::Soldier => 2.0,
            Self::Rocket => 2.8,
            Self::Tank => 4.0,
            Self::Demolition => 6.0,
            Self::Collector => 5.0,
        }
    }
    fn health(self) -> f32 {
        match self {
            Self::Soldier => 100.0,
            Self::Rocket => 80.0,
            Self::Tank => 280.0,
            Self::Demolition => 140.0,
            Self::Collector => 220.0,
        }
    }
    fn speed(self) -> f32 {
        match self {
            Self::Soldier => 7.4,
            Self::Rocket => 6.6,
            Self::Tank => 5.6,
            Self::Demolition => 6.2,
            Self::Collector => 6.0,
        }
    }
    fn radius(self) -> f32 {
        match self {
            Self::Soldier | Self::Rocket => 0.7,
            Self::Tank => 1.45,
            Self::Demolition => 1.25,
            Self::Collector => 1.65,
        }
    }
    fn range(self) -> f32 {
        match self {
            Self::Soldier => 7.0,
            Self::Rocket => 10.0,
            Self::Tank => 10.5,
            Self::Demolition => 3.0,
            Self::Collector => 0.0,
        }
    }
    fn interval(self) -> f32 {
        match self {
            Self::Soldier => 0.7,
            Self::Rocket => 1.35,
            Self::Tank => 1.15,
            Self::Demolition => 1.0,
            Self::Collector => 1.0,
        }
    }
    fn damage(self, victim: Option<Self>) -> f32 {
        match (self, victim) {
            (Self::Soldier, Some(Self::Rocket)) => 19.0,
            (Self::Soldier, Some(Self::Tank)) => 5.0,
            (Self::Soldier, _) => 12.0,
            // Anti-armor damage must pay for the trooper's low health and
            // slightly shorter range, including at equal total army cost.
            (Self::Rocket, Some(Self::Tank)) => 78.0,
            (Self::Rocket, Some(Self::Collector | Self::Demolition)) => 52.0,
            (Self::Rocket, Some(Self::Soldier | Self::Rocket)) => 13.0,
            (Self::Rocket, None) => 36.0,
            (Self::Tank, Some(Self::Soldier)) => 34.0,
            (Self::Tank, Some(Self::Rocket)) => 18.0,
            (Self::Tank, _) => 28.0,
            (Self::Demolition | Self::Collector, _) => 0.0,
        }
    }
    fn production_building(self) -> BuildingKind {
        match self {
            Self::Tank | Self::Demolition | Self::Collector => BuildingKind::Factory,
            _ => BuildingKind::Barracks,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UnitState {
    Gather,
    Attack,
    Harvest,
    Garrison,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildingKind {
    Command,
    Barracks,
    Factory,
    Refinery,
}

#[derive(Clone, Serialize)]
pub struct OreDeposit {
    pub id: u32,
    pub x: f32,
    pub z: f32,
    pub amount: f32,
    pub max_amount: f32,
}

#[derive(Clone, Serialize)]
pub struct Unit {
    pub id: u32,
    pub team: Team,
    pub kind: UnitKind,
    pub x: f32,
    pub z: f32,
    pub hp: f32,
    pub max_hp: f32,
    pub state: UnitState,
    pub cargo: f32,
    pub returning: bool,
    pub garrison: Option<u32>,
    #[serde(skip)]
    cooldown: f32,
    #[serde(skip)]
    detonated: bool,
    #[serde(skip)]
    navigation: navigation::Navigation,
    #[serde(skip)]
    rally_x: f32,
    #[serde(skip)]
    rally_z: f32,
}

impl Unit {
    fn on_field(&self) -> bool {
        self.hp > 0.0 && self.state != UnitState::Garrison
    }
}

#[derive(Clone, Serialize)]
pub struct Building {
    pub id: u32,
    pub team: Team,
    pub kind: BuildingKind,
    pub x: f32,
    pub z: f32,
    pub hp: f32,
    pub max_hp: f32,
    #[serde(skip)]
    cooldown: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Gather,
    Attack,
    Retreat,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Playing,
    Victory,
    Defeat,
}

#[derive(Clone, Serialize)]
pub struct CombatShot {
    pub id: u32,
    pub time: f32,
    pub source_id: u32,
    pub source_is_unit: bool,
    pub kind: UnitKind,
    pub source_y: f32,
    pub target_y: f32,
    pub x: f32,
    pub z: f32,
    pub target_x: f32,
    pub target_z: f32,
}

#[derive(Clone, Serialize)]
pub struct Explosion {
    pub id: u32,
    pub time: f32,
    pub x: f32,
    pub z: f32,
    pub radius: f32,
}

#[derive(Serialize)]
pub struct Game {
    pub time: f32,
    pub demo: bool,
    pub difficulty: Difficulty,
    pub credits: f32,
    pub mode: Mode,
    pub enemy_mode: Mode,
    pub outcome: Outcome,
    pub units: Vec<Unit>,
    pub buildings: Vec<Building>,
    pub ore: Vec<OreDeposit>,
    pub barracks_queue: Vec<UnitKind>,
    pub factory_queue: Vec<UnitKind>,
    pub barracks_progress: f32,
    pub factory_progress: f32,
    pub ai_status: String,
    pub player_kills: u32,
    pub enemy_kills: u32,
    pub shots: Vec<CombatShot>,
    pub explosions: Vec<Explosion>,
    #[serde(skip)]
    next_shot_id: u32,
    #[serde(skip)]
    next_id: u32,
    #[serde(skip)]
    enemy_barracks_queue: Vec<UnitKind>,
    #[serde(skip)]
    enemy_factory_queue: Vec<UnitKind>,
    #[serde(skip)]
    enemy_barracks_progress: f32,
    #[serde(skip)]
    enemy_factory_progress: f32,
    #[serde(skip)]
    ai_decision_timer: f32,
    #[serde(skip)]
    ai_wave_timer: f32,
    #[serde(skip)]
    demo_wave_timer: f32,
    #[serde(skip)]
    ai_credits: f32,
    #[serde(skip)]
    hard_commanders: [ai::HardCommander; 2],
}

impl Default for Game {
    fn default() -> Self {
        Self::new()
    }
}
impl Game {
    #[cfg(feature = "dev-debug")]
    pub(crate) fn debug_snapshot(&self) -> String {
        #[derive(Serialize)]
        struct DebugSnapshot<'a> {
            state: &'a Game,
            internal: serde_json::Value,
        }
        serde_json::to_string(&DebugSnapshot {
            state: self,
            internal: serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "enemy_credits": self.ai_credits,
                "enemy_barracks_queue": self.enemy_barracks_queue,
                "enemy_factory_queue": self.enemy_factory_queue,
                "enemy_barracks_progress": self.enemy_barracks_progress,
                "enemy_factory_progress": self.enemy_factory_progress,
                "decision_timer": self.ai_decision_timer,
                "wave_timers": [self.demo_wave_timer, self.ai_wave_timer],
                "commanders": self.hard_commanders,
            }),
        })
        .expect("debug state should always serialize")
    }

    pub fn new() -> Self {
        Self::with_seed(1941)
    }
    pub fn with_seed(seed: u32) -> Self {
        Self::with_difficulty(seed, Difficulty::Medium)
    }
    pub fn with_difficulty(seed: u32, difficulty: Difficulty) -> Self {
        let mut g = Self {
            time: 0.0,
            demo: false,
            difficulty,
            credits: STARTING_CREDITS,
            mode: Mode::Gather,
            enemy_mode: Mode::Gather,
            outcome: Outcome::Playing,
            units: Vec::new(),
            buildings: Vec::new(),
            ore: Vec::new(),
            barracks_queue: vec![],
            factory_queue: vec![],
            barracks_progress: 0.0,
            factory_progress: 0.0,
            ai_status: "ASSESSING YOUR FORCES".into(),
            player_kills: 0,
            enemy_kills: 0,
            shots: Vec::new(),
            explosions: Vec::new(),
            next_shot_id: 1,
            next_id: 1,
            enemy_barracks_queue: vec![],
            enemy_factory_queue: vec![],
            enemy_barracks_progress: 0.0,
            enemy_factory_progress: 0.0,
            ai_decision_timer: 0.0,
            ai_wave_timer: 7.0,
            demo_wave_timer: 7.0,
            ai_credits: STARTING_CREDITS,
            hard_commanders: [
                ai::HardCommander::new(seed ^ 0xa341316c),
                ai::HardCommander::new(seed ^ 0xc8013ea4),
            ],
        };
        for team in [Team::Player, Team::Enemy] {
            let z = if team == Team::Player { 43.0 } else { -43.0 };
            g.add_building(team, BuildingKind::Command, 0.0, z, 1400.0);
            g.add_building(team, BuildingKind::Barracks, -10.0, z, 800.0);
            g.add_building(team, BuildingKind::Factory, 10.0, z, 1000.0);
            g.add_building(team, BuildingKind::Refinery, 0.0, z.signum() * 50.0, 900.0);
            for kind in [
                UnitKind::Soldier,
                UnitKind::Soldier,
                UnitKind::Soldier,
                UnitKind::Tank,
            ] {
                g.spawn(team, kind);
            }
        }
        g.generate_ore(seed);
        g
    }
    pub fn demo_with_seed(seed: u32) -> Self {
        Self::demo_with_difficulty(seed, Difficulty::Medium)
    }
    pub fn demo_with_difficulty(seed: u32, difficulty: Difficulty) -> Self {
        let mut game = Self::with_difficulty(seed, difficulty);
        game.demo = true;
        game.credits = game.ai_credits;
        game
    }

    fn generate_ore(&mut self, mut seed: u32) {
        let mut random = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed as f64 / 4294967296.0) as f32
        };
        // Three bands, on both flanks, guarantee accessible starting ore and
        // contested deposits. Rotate each deposit 180 degrees for equal access.
        for band in 0..3 {
            for side in [-1.0, 1.0] {
                let x = side * (9.0 + random() * 5.0);
                let z = 7.0 + band as f32 * 10.0 + random() * 4.0;
                let amount = 1400.0 + (random() * 800.0).floor();
                for (x, z) in [(x, z), (-x, -z)] {
                    let id = self.id();
                    self.ore.push(OreDeposit {
                        id,
                        x,
                        z,
                        amount,
                        max_amount: amount,
                    });
                }
            }
        }
    }
    fn id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
    fn add_building(&mut self, team: Team, kind: BuildingKind, x: f32, z: f32, hp: f32) {
        let id = self.id();
        self.buildings.push(Building {
            id,
            team,
            kind,
            x,
            z,
            hp,
            max_hp: hp,
            cooldown: 0.0,
        });
    }
    fn spawn(&mut self, team: Team, kind: UnitKind) {
        if kind == UnitKind::Demolition && self.has_demolition(team) {
            return;
        }
        let id = self.id();
        let index = self
            .units
            .iter()
            .filter(|u| {
                u.team == team && matches!(u.state, UnitState::Gather | UnitState::Garrison)
            })
            .count();
        let x = ((index % 7) as f32 - 3.0) * 3.4;
        let row = (index / 7).min(3) as f32;
        let direction = if team == Team::Player { 1.0 } else { -1.0 };
        let mode = self.team_mode(team);
        let shelter = self
            .buildings
            .iter()
            .find(|b| b.team == team && b.kind == kind.production_building() && b.hp > 0.0);
        let garrison = if mode == Mode::Retreat {
            shelter.map(|b| b.id)
        } else {
            None
        };
        let state = if garrison.is_some() {
            UnitState::Garrison
        } else if kind == UnitKind::Collector {
            UnitState::Harvest
        } else if mode == Mode::Attack {
            UnitState::Attack
        } else {
            UnitState::Gather
        };
        self.units.push(Unit {
            id,
            team,
            kind,
            x: if garrison.is_some() {
                shelter.unwrap().x
            } else if kind == UnitKind::Collector {
                10.0
            } else {
                x
            },
            z: if garrison.is_some() {
                shelter.unwrap().z
            } else {
                direction * (35.0 + row * 2.2)
            },
            hp: kind.health(),
            max_hp: kind.health(),
            state,
            cargo: 0.0,
            returning: false,
            garrison,
            cooldown: 0.2,
            detonated: false,
            navigation: navigation::Navigation::default(),
            rally_x: x,
            rally_z: direction * (27.0 + row * 2.2),
        });
    }
    pub fn set_mode(&mut self, mode: &str) {
        if self.demo || self.outcome != Outcome::Playing {
            return;
        }
        let mode = match mode {
            "attack" => Mode::Attack,
            "gather" => Mode::Gather,
            "retreat" => Mode::Retreat,
            _ => return,
        };
        self.set_team_mode(Team::Player, mode);
    }
    fn team_mode(&self, team: Team) -> Mode {
        if team == Team::Player {
            self.mode
        } else {
            self.enemy_mode
        }
    }
    fn set_team_mode(&mut self, team: Team, mode: Mode) {
        if team == Team::Player {
            self.mode = mode;
        } else {
            self.enemy_mode = mode;
        }
        for u in self
            .units
            .iter_mut()
            .filter(|u| u.team == team && u.hp > 0.0)
        {
            if u.state == UnitState::Garrison {
                if mode == Mode::Retreat {
                    continue;
                }
                if !deploy_garrisoned_unit(u, &self.buildings, mode) {
                    u.hp = 0.0;
                    continue;
                }
            }
            if u.kind != UnitKind::Collector {
                if mode == Mode::Attack {
                    u.state = UnitState::Attack;
                }
                if mode == Mode::Retreat {
                    u.state = UnitState::Gather;
                }
            }
        }
        self.resolve_collisions();
    }
    pub fn eject_garrisoned(&mut self, id: u32) {
        if self.demo || self.outcome != Outcome::Playing {
            return;
        }
        let Some(unit) = self.units.iter_mut().find(|u| {
            u.id == id && u.team == Team::Player && u.hp > 0.0 && u.state == UnitState::Garrison
        }) else {
            return;
        };
        if deploy_garrisoned_unit(unit, &self.buildings, self.mode) {
            self.resolve_collisions();
        }
    }

    pub fn attack_selected(&mut self, ids: &[u32]) {
        if self.demo || self.outcome != Outcome::Playing || self.mode == Mode::Retreat {
            return;
        }
        for u in &mut self.units {
            if u.team == Team::Player && u.state == UnitState::Gather && ids.contains(&u.id) {
                u.state = UnitState::Attack;
            }
        }
    }
    pub fn train(&mut self, kind: &str) {
        if self.demo || self.outcome != Outcome::Playing {
            return;
        }
        let Some(kind) = UnitKind::parse(kind) else {
            return;
        };
        self.queue_unit(Team::Player, kind);
    }

    pub fn cancel_training(&mut self, building: &str, index: usize) {
        if self.demo || self.outcome != Outcome::Playing {
            return;
        }
        let (queue, progress) = match building {
            "barracks" => (&mut self.barracks_queue, &mut self.barracks_progress),
            "factory" => (&mut self.factory_queue, &mut self.factory_progress),
            _ => return,
        };
        if index >= queue.len() {
            return;
        }
        let kind = queue.remove(index);
        self.credits = (self.credits + kind.cost()).min(CREDIT_CAP);
        if index == 0 {
            *progress = 0.0;
        }
    }
    // Reserving the slot at queue time prevents paying for blocked duplicates.
    fn has_demolition(&self, team: Team) -> bool {
        self.units
            .iter()
            .any(|u| u.team == team && u.kind == UnitKind::Demolition && u.hp > 0.0)
            || if team == Team::Player {
                self.factory_queue.contains(&UnitKind::Demolition)
            } else {
                self.enemy_factory_queue.contains(&UnitKind::Demolition)
            }
    }
    fn alive_building(&self, team: Team, kind: BuildingKind) -> bool {
        self.buildings
            .iter()
            .any(|b| b.team == team && b.kind == kind && b.hp > 0.0)
    }
    pub fn update(&mut self, dt: f32) {
        if self.outcome != Outcome::Playing || !dt.is_finite() || dt <= 0.0 {
            return;
        }
        let mut remaining = dt.min(0.25);
        while remaining > 0.0001 && self.outcome == Outcome::Playing {
            let step = remaining.min(0.05);
            self.step(step);
            remaining -= step;
        }
    }
    fn step(&mut self, dt: f32) {
        self.time += dt;
        self.shots.retain(|shot| self.time - shot.time < 1.0);
        self.explosions.retain(|blast| self.time - blast.time < 1.0);
        self.credits = (self.credits + PASSIVE_INCOME * dt).min(CREDIT_CAP);
        self.ai_credits = (self.ai_credits + PASSIVE_INCOME * dt).min(CREDIT_CAP);
        self.harvest_and_unload(dt);
        self.ai_decision_timer -= dt;
        self.ai_wave_timer -= dt;
        if self.demo {
            self.demo_wave_timer -= dt;
        }
        if self.ai_decision_timer <= 0.0 {
            self.ai_decide();
            if self.demo {
                self.ai_decide_for(Team::Player);
            }
            self.ai_decision_timer = self.difficulty.decision_interval();
        }
        let pb = self.alive_building(Team::Player, BuildingKind::Barracks);
        let pf = self.alive_building(Team::Player, BuildingKind::Factory);
        let eb = self.alive_building(Team::Enemy, BuildingKind::Barracks);
        let ef = self.alive_building(Team::Enemy, BuildingKind::Factory);
        if pb {
            if let Some(k) =
                progress_queue(&mut self.barracks_queue, &mut self.barracks_progress, dt)
            {
                self.spawn(Team::Player, k);
            }
        }
        if pf {
            if let Some(k) = progress_queue(&mut self.factory_queue, &mut self.factory_progress, dt)
            {
                self.spawn(Team::Player, k);
            }
        }
        if eb {
            if let Some(k) = progress_queue(
                &mut self.enemy_barracks_queue,
                &mut self.enemy_barracks_progress,
                dt,
            ) {
                self.spawn(Team::Enemy, k);
            }
        }
        if ef {
            if let Some(k) = progress_queue(
                &mut self.enemy_factory_queue,
                &mut self.enemy_factory_progress,
                dt,
            ) {
                self.spawn(Team::Enemy, k);
            }
        }
        self.combat_and_move(dt);
        self.resolve_collisions();
        self.units.retain(|u| u.hp > 0.0);
        self.buildings.retain(|b| b.hp > 0.0);
        if !self.alive_building(Team::Player, BuildingKind::Barracks) {
            self.barracks_queue.clear();
            self.barracks_progress = 0.0;
        }
        if !self.alive_building(Team::Player, BuildingKind::Factory) {
            self.factory_queue.clear();
            self.factory_progress = 0.0;
        }
        if !self.alive_building(Team::Enemy, BuildingKind::Barracks) {
            self.enemy_barracks_queue.clear();
            self.enemy_barracks_progress = 0.0;
        }
        if !self.alive_building(Team::Enemy, BuildingKind::Factory) {
            self.enemy_factory_queue.clear();
            self.enemy_factory_progress = 0.0;
        }
        let player_alive = self.units.iter().any(|u| u.team == Team::Player)
            || self.buildings.iter().any(|b| b.team == Team::Player);
        let enemy_alive = self.units.iter().any(|u| u.team == Team::Enemy)
            || self.buildings.iter().any(|b| b.team == Team::Enemy);
        self.outcome = if !player_alive {
            Outcome::Defeat
        } else if !enemy_alive {
            Outcome::Victory
        } else {
            Outcome::Playing
        };
    }
    fn ai_decide(&mut self) {
        self.ai_decide_for(Team::Enemy);
    }

    fn production_queue(&self, team: Team, building: BuildingKind) -> &[UnitKind] {
        match (team, building) {
            (Team::Player, BuildingKind::Factory) => &self.factory_queue,
            (Team::Player, _) => &self.barracks_queue,
            (Team::Enemy, BuildingKind::Factory) => &self.enemy_factory_queue,
            (Team::Enemy, _) => &self.enemy_barracks_queue,
        }
    }

    fn occupied_production_slots(&self, team: Team, kind: BuildingKind) -> usize {
        let host = self
            .buildings
            .iter()
            .find(|b| b.team == team && b.kind == kind && b.hp > 0.0);
        let sheltered = host.map_or(0, |b| {
            self.units
                .iter()
                .filter(|u| {
                    u.team == team
                        && u.hp > 0.0
                        && u.state == UnitState::Garrison
                        && u.garrison == Some(b.id)
                })
                .count()
        });
        self.production_queue(team, kind).len() + sheltered
    }

    fn queue_unit(&mut self, team: Team, kind: UnitKind) {
        // One purchase path for human and AI orders keeps all production rules equal.
        if !self.alive_building(team, kind.production_building())
            || self.occupied_production_slots(team, kind.production_building()) >= QUEUE_LIMIT
            || (kind == UnitKind::Collector && !self.alive_building(team, BuildingKind::Refinery))
            || (kind == UnitKind::Demolition && self.has_demolition(team))
        {
            return;
        }
        let credits = if team == Team::Player {
            &mut self.credits
        } else {
            &mut self.ai_credits
        };
        if *credits < kind.cost() {
            return;
        }
        *credits -= kind.cost();
        match (team, kind.production_building()) {
            (Team::Player, BuildingKind::Factory) => self.factory_queue.push(kind),
            (Team::Player, _) => self.barracks_queue.push(kind),
            (Team::Enemy, BuildingKind::Factory) => self.enemy_factory_queue.push(kind),
            (Team::Enemy, _) => self.enemy_barracks_queue.push(kind),
        }
    }

    // Both demo commanders use the same production and wave strategy, viewed
    // from their own end of the map. Normal matches still run only the enemy AI.
    fn ai_decide_for(&mut self, team: Team) {
        match self.difficulty {
            Difficulty::Easy => self.ai_easy(team),
            Difficulty::Medium => self.ai_medium(team),
            Difficulty::Hard => self.ai_hard(team),
        }
    }

    fn ai_medium(&mut self, team: Team) {
        let opponent = if team == Team::Enemy {
            Team::Player
        } else {
            Team::Enemy
        };
        let direction = if team == Team::Enemy { 1.0 } else { -1.0 };
        let wave_timer = if team == Team::Enemy {
            self.ai_wave_timer
        } else {
            self.demo_wave_timer
        };
        let collectors = self
            .units
            .iter()
            .filter(|u| u.team == team && u.kind == UnitKind::Collector)
            .count()
            + self
                .production_queue(team, BuildingKind::Factory)
                .iter()
                .filter(|&&k| k == UnitKind::Collector)
                .count();
        let wants_collector = self.time >= 3.0
            && collectors < 2
            && self.alive_building(team, BuildingKind::Refinery)
            && self.alive_building(team, BuildingKind::Factory)
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
            && self.ore.iter().any(|o| o.amount > 0.0);
        if wants_collector {
            self.queue_unit(team, UnitKind::Collector);
        }
        // The whole battlefield is visible, but opposing queues and sheltered
        // units are private. Only our own committed production informs planning.
        let mut player = [0.0f32; 4];
        let mut enemy = [0.0f32; 4];
        for u in &self.units {
            if u.hp <= 0.0 || u.kind == UnitKind::Collector {
                continue;
            }
            let index = unit_index(u.kind);
            if u.team == opponent {
                if u.on_field() {
                    player[index] += 1.0;
                }
            } else {
                // A unit deep in enemy territory is less useful as a local reserve.
                enemy[index] += if u.state == UnitState::Attack && u.z * direction > 5.0 {
                    0.5
                } else {
                    1.0
                };
            }
        }
        for k in self
            .production_queue(team, BuildingKind::Barracks)
            .iter()
            .chain(self.production_queue(team, BuildingKind::Factory))
        {
            if *k == UnitKind::Collector {
                continue;
            }
            enemy[unit_index(*k)] += 1.0;
        }

        let threatened = self.units.iter().any(|u| {
            u.team == opponent
                && u.on_field()
                && u.kind != UnitKind::Collector
                && u.z * direction < -10.0
        });
        // Compare the incoming force with units available on our half of the map,
        // including sheltered production. Different entry/exit thresholds keep
        // the commander from switching modes on every decision.
        let strength = |u: &Unit| u.kind.cost() * (u.hp / u.max_hp).clamp(0.0, 1.0);
        let pressure: f32 = self
            .units
            .iter()
            .filter(|u| {
                u.team == opponent
                    && u.on_field()
                    && u.kind != UnitKind::Collector
                    && u.z * direction < -10.0
            })
            .map(strength)
            .sum();
        let defense: f32 = self
            .units
            .iter()
            .filter(|u| {
                u.team == team
                    && u.hp > 0.0
                    && u.kind != UnitKind::Collector
                    && u.z * direction < 5.0
            })
            .map(strength)
            .sum();
        let retreating = self.team_mode(team) == Mode::Retreat;
        let can_rebuild = self.alive_building(team, BuildingKind::Barracks)
            || self.alive_building(team, BuildingKind::Factory);
        let should_retreat = can_rebuild
            && pressure > 0.0
            && pressure > defense * if retreating { 1.05 } else { 1.5 };
        if should_retreat && !retreating {
            self.set_team_mode(team, Mode::Retreat);
        } else if retreating && !should_retreat {
            self.set_team_mode(team, Mode::Gather);
        }
        let reserves = self
            .units
            .iter()
            .filter(|u| {
                u.team == team
                    && u.kind != UnitKind::Collector
                    && matches!(u.state, UnitState::Gather | UnitState::Garrison)
            })
            .count();
        if !should_retreat
            && (threatened || (wave_timer <= 0.0 && (reserves >= 3 || wave_timer <= -4.0)))
        {
            for u in &mut self.units {
                if u.team == team && u.state == UnitState::Gather {
                    u.state = UnitState::Attack;
                }
            }
            let next_wave = if threatened { 7.0 } else { 9.0 };
            if team == Team::Enemy {
                self.ai_wave_timer = next_wave;
            } else {
                self.demo_wave_timer = next_wave;
            }
        }

        // Soldiers counter rockets, rockets counter armor, and tanks counter infantry.
        // A baseline of every role prevents a single small scout from pulling the
        // entire army into one unit type.
        let desired_soldiers = 2.0 + player[1] * 1.3 + player[0] * 0.25;
        let desired_rockets = 1.0 + player[2] * 1.4 + player[3] * 2.0;
        let desired_tanks = 1.0 + player[0] * 0.55;
        let soldier_need = desired_soldiers - enemy[0];
        let rocket_need = desired_rockets - enemy[1];
        let choice = if rocket_need > soldier_need {
            UnitKind::Rocket
        } else {
            UnitKind::Soldier
        };
        if team == Team::Enemy {
            self.ai_status = if should_retreat {
                "RETREATING TO REGROUP"
            } else if threatened {
                "INTERCEPTING YOUR ADVANCE"
            } else if player[2] > player[0] && player[2] >= player[1] {
                "COUNTERING YOUR ARMOR"
            } else if player[1] > player[2] {
                "COUNTERING YOUR ROCKET TROOPS"
            } else {
                "BUILDING A COMBINED FORCE"
            }
            .into();
        }
        if wants_collector
            && !threatened
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
        {
            // Save for the economy while reserves still handle wave deployment.
            return;
        }
        // Occasionally breach a large infantry force, after the economy is running.
        // Never replace emergency defenders with a truck or stack queued trucks.
        let wants_demolition = self.time >= 35.0
            && !threatened
            && player[0] + player[1] >= 6.0
            && player[1] <= player[0]
            && reserves >= 3
            && !self.has_demolition(team)
            && self.alive_building(team, BuildingKind::Factory)
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty();
        if wants_demolition {
            self.queue_unit(team, UnitKind::Demolition);
        }
        // Avoid feeding armor into a rocket-heavy army. Save for a tank when
        // an infantry-heavy opponent makes armor the most urgent missing role.
        let tank_limit = if player[1] > player[0] {
            1.0
        } else {
            desired_tanks
        };
        let tank_need = tank_limit - enemy[2];
        let wants_tank = self.alive_building(team, BuildingKind::Factory)
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
            && tank_need > 0.0;
        let prioritize_tank =
            wants_tank && player[0] > player[2] && tank_need > soldier_need.max(rocket_need);
        if prioritize_tank {
            self.queue_unit(team, UnitKind::Tank);
        }
        if (!prioritize_tank
            || !self
                .production_queue(team, BuildingKind::Factory)
                .is_empty())
            && self.alive_building(team, BuildingKind::Barracks)
            && self.production_queue(team, BuildingKind::Barracks).len() < 2
        {
            self.queue_unit(team, choice);
        }
        if wants_tank
            && self
                .production_queue(team, BuildingKind::Factory)
                .is_empty()
        {
            self.queue_unit(team, UnitKind::Tank);
        }
    }
    fn harvest_and_unload(&mut self, dt: f32) {
        let snapshot = self.units.clone();
        for unit in &mut self.units {
            if unit.kind != UnitKind::Collector || !unit.on_field() {
                continue;
            }
            let refinery = self
                .buildings
                .iter()
                .filter(|b| b.team == unit.team && b.kind == BuildingKind::Refinery && b.hp > 0.0)
                .min_by(|a, b| {
                    distance_sq(unit.x, unit.z, a.x, a.z)
                        .total_cmp(&distance_sq(unit.x, unit.z, b.x, b.z))
                });
            let Some(refinery) = refinery else {
                continue;
            };
            let deposit = self
                .ore
                .iter()
                .enumerate()
                .filter(|(_, o)| o.amount > 0.0)
                .min_by(|(_, a), (_, b)| {
                    distance_sq(unit.x, unit.z, a.x, a.z)
                        .total_cmp(&distance_sq(unit.x, unit.z, b.x, b.z))
                })
                .map(|(i, _)| i);
            unit.returning |=
                unit.cargo >= COLLECTOR_CAPACITY || (deposit.is_none() && unit.cargo > 0.0);
            let (x, z, stopping_distance) = if unit.returning {
                (refinery.x, refinery.z, 5.4)
            } else if let Some(i) = deposit {
                (self.ore[i].x, self.ore[i].z, 3.0)
            } else {
                continue;
            };
            let distance = distance_sq(unit.x, unit.z, x, z).sqrt();
            if distance > stopping_distance + 0.01 {
                navigation::move_toward(
                    unit,
                    (x, z),
                    stopping_distance,
                    dt,
                    &snapshot,
                    &self.buildings,
                );
            } else if unit.returning {
                if unit.team == Team::Player {
                    self.credits = (self.credits + unit.cargo).min(CREDIT_CAP);
                } else {
                    self.ai_credits = (self.ai_credits + unit.cargo).min(CREDIT_CAP);
                }
                unit.cargo = 0.0;
                unit.returning = false;
            } else if let Some(i) = deposit {
                let ore = &mut self.ore[i];
                let mined = (MINING_RATE * dt)
                    .min(ore.amount)
                    .min(COLLECTOR_CAPACITY - unit.cargo);
                unit.cargo += mined;
                ore.amount -= mined;
                // Deliver a partial load when this deposit is exhausted.
                unit.returning = unit.cargo >= COLLECTOR_CAPACITY || ore.amount <= 0.0;
            }
        }
    }
    // Resolve all units together, including collectors and opposing teams. Small
    // simulation steps prevent moving units from tunneling through one another.
    fn resolve_collisions(&mut self) {
        for _ in 0..48 {
            let mut overlap_found = false;
            for unit in &mut self.units {
                if !unit.on_field() {
                    continue;
                }
                let radius = unit.kind.radius();
                for building in self.buildings.iter().filter(|b| b.hp > 0.0) {
                    let (half_x, half_z) = building_half_size(building.kind);
                    let dx = unit.x - building.x;
                    let dz = unit.z - building.z;
                    let closest_x = dx.clamp(-half_x, half_x);
                    let closest_z = dz.clamp(-half_z, half_z);
                    let (ox, oz) = (dx - closest_x, dz - closest_z);
                    let distance = (ox * ox + oz * oz).sqrt();
                    if distance > 0.0 && distance < radius {
                        overlap_found = true;
                        unit.x += ox / distance * (radius - distance);
                        unit.z += oz / distance * (radius - distance);
                    } else if distance == 0.0 {
                        overlap_found = true;
                        // A newly spawned or displaced unit inside the footprint
                        // leaves through its nearest side.
                        let x_gap = half_x - dx.abs();
                        let z_gap = half_z - dz.abs();
                        if x_gap < z_gap {
                            unit.x =
                                building.x + if dx < 0.0 { -1.0 } else { 1.0 } * (half_x + radius);
                        } else {
                            unit.z =
                                building.z + if dz < 0.0 { -1.0 } else { 1.0 } * (half_z + radius);
                        }
                    }
                }
                unit.x = unit.x.clamp(-FIELD_EDGE, FIELD_EDGE);
            }
            for i in 0..self.units.len() {
                let (left, right) = self.units.split_at_mut(i + 1);
                let a = &mut left[i];
                if !a.on_field() {
                    continue;
                }
                for b in right.iter_mut().filter(|u| u.on_field()) {
                    let (dx, dz) = (b.x - a.x, b.z - a.z);
                    let distance = (dx * dx + dz * dz).sqrt();
                    let overlap = a.kind.radius() + b.kind.radius() - distance;
                    if overlap > 0.00001 {
                        overlap_found = true;
                        let (nx, nz) = if distance > 0.0001 {
                            (dx / distance, dz / distance)
                        } else {
                            (if a.id < b.id { 1.0 } else { -1.0 }, 0.0)
                        };
                        a.x = (a.x - nx * overlap * 0.5).clamp(-FIELD_EDGE, FIELD_EDGE);
                        a.z -= nz * overlap * 0.5;
                        b.x = (b.x + nx * overlap * 0.5).clamp(-FIELD_EDGE, FIELD_EDGE);
                        b.z += nz * overlap * 0.5;
                    }
                }
            }
            if !overlap_found {
                break;
            }
        }
    }
    fn combat_and_move(&mut self, dt: f32) {
        // Work from one snapshot so every unit acts simultaneously and targeting is deterministic.
        let snapshot = self.units.clone();
        let buildings = self.buildings.clone();
        let mut unit_damage = vec![0.0f32; snapshot.len()];
        let mut building_damage = vec![0.0f32; buildings.len()];
        let mut detonating = Vec::new();
        let player_retreat = self.mode == Mode::Retreat;
        let enemy_retreat = self.enemy_mode == Mode::Retreat;
        for (unit_index, unit) in self.units.iter_mut().enumerate() {
            if !unit.on_field() || unit.kind == UnitKind::Collector {
                continue;
            }
            unit.cooldown = (unit.cooldown - dt).max(0.0);
            let retreating = if unit.team == Team::Player {
                player_retreat
            } else {
                enemy_retreat
            };
            if retreating && distance_sq(unit.x, unit.z, unit.rally_x, unit.rally_z) > 1.0 {
                navigation::move_toward(
                    unit,
                    (unit.rally_x, unit.rally_z),
                    0.15,
                    dt,
                    &snapshot,
                    &buildings,
                );
                continue;
            }
            let target_unit = snapshot
                .iter()
                .enumerate()
                .filter(|(_, v)| v.team != unit.team && v.on_field())
                .map(|(j, v)| (j, distance_sq(unit.x, unit.z, v.x, v.z)))
                .min_by(|a, b| a.1.total_cmp(&b.1));
            let target_building = buildings
                .iter()
                .enumerate()
                .filter(|(_, b)| b.team != unit.team && b.hp > 0.0)
                .map(|(j, b)| (j, distance_sq(unit.x, unit.z, b.x, b.z)))
                .min_by(|a, b| a.1.total_cmp(&b.1));
            let nearest_unit_distance = target_unit.map(|(_, d)| d).unwrap_or(f32::INFINITY);
            let nearest_building_distance =
                target_building.map(|(_, d)| d).unwrap_or(f32::INFINITY);
            // Units in reserve defend locally, but never chase away from the rally area.
            let range = unit.kind.range();
            let firing_target = snapshot
                .iter()
                .enumerate()
                .filter(|(_, v)| {
                    v.team != unit.team
                        && v.on_field()
                        && distance_sq(unit.x, unit.z, v.x, v.z) <= range * range
                })
                .max_by(|(_, a), (_, b)| {
                    let score = |v: &Unit| {
                        unit.kind.damage(Some(v.kind))
                            / (1.0 + distance_sq(unit.x, unit.z, v.x, v.z).sqrt() / range * 0.3)
                    };
                    score(a).total_cmp(&score(b))
                })
                .map(|(j, _)| j);
            let unit_in_range = firing_target.is_some();
            let building_range = if unit.kind == UnitKind::Demolition {
                target_building
                    .map(|(j, _)| {
                        let (hx, hz) = building_half_size(buildings[j].kind);
                        let dx = unit.x - buildings[j].x;
                        let dz = unit.z - buildings[j].z;
                        let distance = (dx * dx + dz * dz).sqrt();
                        // Intersect the approach ray with the rectangular footprint.
                        let edge = (hx / dx.abs().max(0.001)).min(hz / dz.abs().max(0.001));
                        distance * edge.min(1.0) + unit.kind.radius() + 0.6
                    })
                    .unwrap_or(range)
            } else {
                range + 2.3
            };
            let building_in_range = nearest_building_distance <= building_range * building_range;
            if unit.cooldown <= 0.0 && (unit_in_range || building_in_range) {
                if unit.kind == UnitKind::Demolition {
                    detonating.push(unit_index);
                    continue;
                }
                if unit_in_range {
                    let j = firing_target.unwrap();
                    unit_damage[j] += unit.kind.damage(Some(snapshot[j].kind));
                } else {
                    let (j, _) = target_building.unwrap();
                    building_damage[j] += unit.kind.damage(None);
                }
                let (target_x, target_y, target_z) = if let Some(j) = firing_target {
                    (snapshot[j].x, 1.1, snapshot[j].z)
                } else {
                    let (j, _) = target_building.unwrap();
                    (buildings[j].x, 2.0, buildings[j].z)
                };
                self.shots.push(CombatShot {
                    id: self.next_shot_id,
                    time: self.time,
                    source_id: unit.id,
                    source_is_unit: true,
                    kind: unit.kind,
                    source_y: match unit.kind {
                        UnitKind::Tank => 1.7,
                        UnitKind::Rocket => 1.53,
                        _ => 1.1,
                    },
                    target_y,
                    x: unit.x,
                    z: unit.z,
                    target_x,
                    target_z,
                });
                self.next_shot_id += 1;
                unit.cooldown = unit.kind.interval();
            } else if !unit_in_range && !building_in_range {
                let destination = if unit.state == UnitState::Gather {
                    Some((unit.rally_x, unit.rally_z))
                } else if nearest_unit_distance <= nearest_building_distance {
                    target_unit.map(|(j, _)| (snapshot[j].x, snapshot[j].z))
                } else {
                    target_building.map(|(j, _)| (buildings[j].x, buildings[j].z))
                };
                if let Some((x, z)) = destination {
                    let stop = if unit.state == UnitState::Gather {
                        0.15
                    } else if nearest_unit_distance <= nearest_building_distance {
                        range * 0.95
                    } else {
                        building_range
                            * if unit.kind == UnitKind::Demolition {
                                0.98
                            } else {
                                0.95
                            }
                    };
                    navigation::move_toward(unit, (x, z), stop, dt, &snapshot, &buildings);
                }
            }
        }
        // Command centers provide short-range point defense to prevent runaway snowballs.
        for b in &mut self.buildings {
            b.cooldown = (b.cooldown - dt).max(0.0);
            if b.kind == BuildingKind::Command && b.cooldown <= 0.0 {
                if let Some((j, _)) = snapshot
                    .iter()
                    .enumerate()
                    .filter(|(_, u)| {
                        u.team != b.team
                            && u.on_field()
                            && distance_sq(b.x, b.z, u.x, u.z) < 11.0 * 11.0
                    })
                    .map(|(j, u)| (j, distance_sq(b.x, b.z, u.x, u.z)))
                    .min_by(|a, b| a.1.total_cmp(&b.1))
                {
                    unit_damage[j] += 18.0;
                    self.shots.push(CombatShot {
                        id: self.next_shot_id,
                        time: self.time,
                        source_id: b.id,
                        source_is_unit: false,
                        kind: UnitKind::Soldier,
                        source_y: 4.4,
                        target_y: 1.1,
                        x: b.x,
                        z: b.z,
                        target_x: snapshot[j].x,
                        target_z: snapshot[j].z,
                    });
                    self.next_shot_id += 1;
                    b.cooldown = 1.0;
                }
            }
        }
        for (u, damage) in self.units.iter_mut().zip(unit_damage) {
            u.hp -= damage;
        }
        for (b, damage) in self.buildings.iter_mut().zip(building_damage) {
            b.hp -= damage;
        }
        for i in detonating {
            self.units[i].hp = 0.0;
        }
        // Resolve deaths before cleanup, including trucks killed by another blast.
        // Mark each source first so simultaneous attack/death only explodes once.
        loop {
            let source = self.units.iter().position(|u| {
                u.kind == UnitKind::Demolition
                    && u.state != UnitState::Garrison
                    && u.hp <= 0.0
                    && !u.detonated
            });
            let Some(i) = source else { break };
            self.units[i].detonated = true;
            let (x, z) = (self.units[i].x, self.units[i].z);
            self.explosions.push(Explosion {
                id: self.next_shot_id,
                time: self.time,
                x,
                z,
                radius: DEMOLITION_RADIUS,
            });
            self.next_shot_id += 1;
            for u in &mut self.units {
                if u.on_field() {
                    u.hp -= demolition_damage(distance_sq(x, z, u.x, u.z).sqrt());
                }
            }
            for b in &mut self.buildings {
                if b.hp > 0.0 {
                    let (hx, hz) = building_half_size(b.kind);
                    let dx = ((x - b.x).abs() - hx).max(0.0);
                    let dz = ((z - b.z).abs() - hz).max(0.0);
                    b.hp -= demolition_damage((dx * dx + dz * dz).sqrt());
                }
            }
        }
        // Occupants are protected while their building stands and lost with it.
        for u in &mut self.units {
            if u.state == UnitState::Garrison
                && !self
                    .buildings
                    .iter()
                    .any(|b| Some(b.id) == u.garrison && b.hp > 0.0)
            {
                u.hp = 0.0;
            }
        }
        for (before, after) in snapshot.iter().zip(&self.units) {
            if before.hp > 0.0 && after.hp <= 0.0 {
                if after.team == Team::Enemy {
                    self.player_kills += 1;
                } else {
                    self.enemy_kills += 1;
                }
            }
        }
        for (before, after) in buildings.iter().zip(&self.buildings) {
            if before.hp > 0.0 && after.hp <= 0.0 {
                if after.team == Team::Enemy {
                    self.player_kills += 1;
                } else {
                    self.enemy_kills += 1;
                }
            }
        }
    }
}

// Individual ejection and mode-wide release use the same exit and deployment state.
fn deploy_garrisoned_unit(unit: &mut Unit, buildings: &[Building], mode: Mode) -> bool {
    let Some(building) = buildings
        .iter()
        .find(|b| Some(b.id) == unit.garrison && b.team == unit.team && b.hp > 0.0)
    else {
        return false;
    };
    let direction = if unit.team == Team::Player { 1.0 } else { -1.0 };
    let (_, half_z) = building_half_size(building.kind);
    unit.x = building.x;
    unit.z = building.z - direction * (half_z + unit.kind.radius() + 0.3);
    unit.garrison = None;
    unit.state = if unit.kind == UnitKind::Collector {
        UnitState::Harvest
    } else if mode == Mode::Attack {
        UnitState::Attack
    } else {
        UnitState::Gather
    };
    unit.navigation = navigation::Navigation::default();
    true
}

fn demolition_damage(distance: f32) -> f32 {
    DEMOLITION_DAMAGE
        * ((DEMOLITION_RADIUS - distance) / (DEMOLITION_RADIUS - DEMOLITION_CORE)).clamp(0.0, 1.0)
}

fn building_half_size(kind: BuildingKind) -> (f32, f32) {
    match kind {
        BuildingKind::Command => (3.65, 3.3),
        BuildingKind::Barracks => (2.85, 2.65),
        BuildingKind::Factory => (3.225, 3.05),
        BuildingKind::Refinery => (3.55, 2.8),
    }
}

fn unit_index(kind: UnitKind) -> usize {
    match kind {
        UnitKind::Soldier => 0,
        UnitKind::Rocket => 1,
        UnitKind::Tank => 2,
        UnitKind::Demolition => 3,
        UnitKind::Collector => unreachable!("collectors are excluded from army composition"),
    }
}
fn progress_queue(queue: &mut Vec<UnitKind>, progress: &mut f32, dt: f32) -> Option<UnitKind> {
    if let Some(kind) = queue.first().copied() {
        *progress += dt / kind.build_time();
        if *progress >= 1.0 {
            *progress = 0.0;
            queue.remove(0);
            return Some(kind);
        }
    } else {
        *progress = 0.0;
    }
    None
}
fn distance_sq(x: f32, z: f32, other_x: f32, other_z: f32) -> f32 {
    (x - other_x).powi(2) + (z - other_z).powi(2)
}

#[cfg(test)]
mod tests {
    #[test]
    fn garrisons_and_queues_share_nine_slots_per_producer_and_team() {
        for team in [Team::Player, Team::Enemy] {
            for kind in [UnitKind::Soldier, UnitKind::Tank] {
                let mut g = Game::new();
                g.units.clear();
                g.ai_decision_timer = 1000.0;
                g.credits = CREDIT_CAP;
                g.ai_credits = CREDIT_CAP;
                g.set_team_mode(team, Mode::Retreat);
                for _ in 0..9 {
                    g.queue_unit(team, kind);
                }
                let producer = kind.production_building();
                assert_eq!(g.production_queue(team, producer).len(), 9);
                for _ in 0..800 {
                    g.update(0.05);
                    assert_eq!(g.occupied_production_slots(team, producer), 9);
                    let queued = g.production_queue(team, producer).len();
                    let credits = (g.credits, g.ai_credits);
                    g.queue_unit(team, kind);
                    assert_eq!(g.production_queue(team, producer).len(), queued);
                    assert_eq!((g.credits, g.ai_credits), credits);
                }
                assert!(g.production_queue(team, producer).is_empty());
                assert_eq!(
                    g.units
                        .iter()
                        .filter(|u| u.team == team && u.state == UnitState::Garrison)
                        .count(),
                    9
                );
                // The other producer and opposing team still have their own slots.
                let other_kind = if kind == UnitKind::Soldier {
                    UnitKind::Tank
                } else {
                    UnitKind::Soldier
                };
                g.queue_unit(team, other_kind);
                assert_eq!(
                    g.production_queue(team, other_kind.production_building())
                        .len(),
                    1
                );
                let opponent = if team == Team::Player {
                    Team::Enemy
                } else {
                    Team::Player
                };
                g.queue_unit(opponent, kind);
                assert_eq!(g.production_queue(opponent, producer).len(), 1);
            }
        }
    }

    #[test]
    fn individual_ejection_preserves_retreat_and_frees_only_its_slot() {
        let mut g = Game::new();
        g.units.clear();
        g.credits = CREDIT_CAP;
        g.set_mode("retreat");
        for kind in [
            UnitKind::Soldier,
            UnitKind::Rocket,
            UnitKind::Tank,
            UnitKind::Demolition,
            UnitKind::Collector,
        ] {
            g.spawn(Team::Player, kind);
        }
        for _ in 0..7 {
            g.train("soldier");
        }
        g.barracks_progress = 0.5;
        let ids: Vec<_> = g.units.iter().map(|u| u.id).collect();
        for (index, id) in ids.iter().enumerate() {
            let credits = g.credits;
            g.eject_garrisoned(*id);
            assert_eq!(g.mode, Mode::Retreat);
            assert_eq!(g.credits, credits);
            assert_eq!(g.barracks_progress, 0.5);
            assert_eq!(g.units.len(), ids.len());
            let unit = g.units.iter().find(|u| u.id == *id).unwrap();
            assert_eq!(unit.garrison, None);
            assert_eq!(
                unit.state,
                if unit.kind == UnitKind::Collector {
                    UnitState::Harvest
                } else {
                    UnitState::Gather
                }
            );
            for building in &g.buildings {
                let (hx, hz) = building_half_size(building.kind);
                let dx = ((unit.x - building.x).abs() - hx).max(0.0);
                let dz = ((unit.z - building.z).abs() - hz).max(0.0);
                assert!(dx * dx + dz * dz >= (unit.kind.radius() - 0.01).powi(2));
            }
            assert!(g
                .units
                .iter()
                .filter(|u| ids[index + 1..].contains(&u.id))
                .all(|u| u.state == UnitState::Garrison));
            if index == 0 {
                g.train("soldier");
                assert_eq!(g.barracks_queue.len(), 8);
                assert_eq!(
                    g.occupied_production_slots(Team::Player, BuildingKind::Barracks),
                    9
                );
            }
        }
    }

    #[test]
    fn invalid_ejections_do_not_release_units_or_change_resources() {
        let mut g = Game::new();
        g.units.clear();
        g.set_mode("retreat");
        g.set_team_mode(Team::Enemy, Mode::Retreat);
        g.spawn(Team::Player, UnitKind::Soldier);
        g.spawn(Team::Enemy, UnitKind::Soldier);
        let id = g.units[0].id;
        let credits = g.credits;
        g.eject_garrisoned(u32::MAX);
        g.eject_garrisoned(g.units[1].id);
        g.demo = true;
        g.eject_garrisoned(id);
        g.demo = false;
        g.outcome = Outcome::Victory;
        g.eject_garrisoned(id);
        g.outcome = Outcome::Playing;
        let host = g.units[0].garrison;
        g.buildings
            .iter_mut()
            .find(|b| Some(b.id) == host)
            .unwrap()
            .hp = 0.0;
        g.eject_garrisoned(id);
        assert!(g.units.iter().all(|u| u.state == UnitState::Garrison));
        assert_eq!(g.credits, credits);
    }

    #[test]
    fn production_queues_hold_nine_units_for_both_teams() {
        for team in [Team::Player, Team::Enemy] {
            for kind in [UnitKind::Soldier, UnitKind::Tank] {
                let mut g = Game::new();
                g.credits = CREDIT_CAP;
                g.ai_credits = CREDIT_CAP;
                for _ in 0..10 {
                    g.queue_unit(team, kind);
                }
                assert_eq!(
                    g.production_queue(team, kind.production_building()).len(),
                    9
                );
                let credits = if team == Team::Player {
                    g.credits
                } else {
                    g.ai_credits
                };
                assert_eq!(credits, CREDIT_CAP - 9.0 * kind.cost());
            }
        }
    }

    #[test]
    fn cancel_training_refunds_and_only_resets_active_production() {
        let mut g = Game::new();
        g.train("soldier");
        g.train("rocket");
        g.train("soldier");
        g.barracks_progress = 1.0;
        g.cancel_training("barracks", 1);
        assert_eq!(g.barracks_queue, vec![UnitKind::Soldier; 2]);
        assert_eq!(g.barracks_progress, 1.0);
        assert_eq!(g.credits, STARTING_CREDITS - 120.0);
        g.cancel_training("barracks", 0);
        assert_eq!(g.barracks_progress, 0.0);
        g.update(0.1);
        assert_eq!(g.barracks_queue, vec![UnitKind::Soldier]);
        g.cancel_training("barracks", 0);
        assert!(g.barracks_queue.is_empty());
        assert_eq!(g.barracks_progress, 0.0);

        g.train("demolition");
        g.factory_progress = 3.0;
        g.cancel_training("factory", 0);
        assert_eq!(g.factory_progress, 0.0);
        g.train("demolition");
        assert_eq!(g.factory_queue, vec![UnitKind::Demolition]);
        g.credits = CREDIT_CAP - 1.0;
        g.cancel_training("factory", 0);
        assert_eq!(g.credits, CREDIT_CAP);
    }

    #[test]
    fn invalid_or_disabled_cancellations_do_not_change_state() {
        let mut g = Game::new();
        g.train("tank");
        g.factory_progress = 1.0;
        let credits = g.credits;
        g.cancel_training("factory", 1);
        g.cancel_training("command", 0);
        g.cancel_training("barracks", 0);
        g.demo = true;
        g.cancel_training("factory", 0);
        g.demo = false;
        g.outcome = Outcome::Victory;
        g.cancel_training("factory", 0);
        assert_eq!(g.factory_queue, vec![UnitKind::Tank]);
        assert_eq!(g.factory_progress, 1.0);
        assert_eq!(g.credits, credits);
    }

    fn isolated_units(kinds: &[(Team, UnitKind, f32, f32)]) -> Game {
        let mut g = Game::new();
        g.units.clear();
        g.buildings.clear();
        for &(team, kind, x, z) in kinds {
            g.spawn(team, kind);
            let u = g.units.last_mut().unwrap();
            u.x = x;
            u.z = z;
            u.rally_x = x;
            u.rally_z = z;
            u.cooldown = 0.0;
        }
        g
    }

    #[test]
    fn demo_commanders_produce_mine_deploy_and_fight_without_input() {
        let mut g = Game::demo_with_seed(1941);
        assert_eq!(g.credits, g.ai_credits);
        let first_new_id = g.next_id;
        for _ in 0..400 {
            g.update(0.05);
        }
        for team in [Team::Player, Team::Enemy] {
            assert!(g
                .units
                .iter()
                .any(|u| u.team == team && u.id >= first_new_id));
            assert!(g
                .units
                .iter()
                .any(|u| u.team == team && u.kind == UnitKind::Collector));
            assert!(g
                .units
                .iter()
                .any(|u| u.team == team && u.state == UnitState::Attack));
        }
        for _ in 0..1400 {
            g.update(0.05);
        }
        assert!(g.player_kills > 0, "blue AI must engage the red army");
        assert!(g.enemy_kills > 0, "red AI must engage the blue army");
        assert!(g.ore.iter().any(|o| o.amount < o.max_amount));
        assert!((0.0..=CREDIT_CAP).contains(&g.credits));
        assert!((0.0..=CREDIT_CAP).contains(&g.ai_credits));
    }

    #[test]
    fn demo_ignores_player_commands_and_normal_matches_remain_controllable() {
        let mut g = Game::demo_with_seed(5);
        let initial = serde_json::to_string(&g).unwrap();
        let ids: Vec<_> = g.units.iter().map(|u| u.id).collect();
        g.train("tank");
        g.set_mode("attack");
        g.attack_selected(&ids);
        assert_eq!(serde_json::to_string(&g).unwrap(), initial);

        let mut normal = Game::with_seed(5);
        normal.train("tank");
        normal.set_mode("attack");
        assert!(!normal.demo);
        assert_eq!(normal.factory_queue, vec![UnitKind::Tank]);
        assert_eq!(normal.mode, Mode::Attack);
        assert_eq!(normal.time, 0.0);
    }

    #[test]
    fn demo_stops_when_either_side_is_eliminated() {
        for loser in [Team::Player, Team::Enemy] {
            let mut g = Game::demo_with_seed(26);
            g.units.retain(|u| u.team != loser);
            g.buildings.retain(|b| b.team != loser);
            g.update(0.05);
            assert_eq!(
                g.outcome,
                if loser == Team::Player {
                    Outcome::Defeat
                } else {
                    Outcome::Victory
                }
            );
            let finished = serde_json::to_string(&g).unwrap();
            g.update(0.25);
            assert_eq!(serde_json::to_string(&g).unwrap(), finished);
        }
    }

    #[test]
    fn demolition_reserves_one_slot_per_team_and_can_be_replaced_after_death() {
        let mut g = Game::new();
        g.train("demolition");
        assert_eq!(g.credits, 250.0);
        assert_eq!(g.factory_queue, vec![UnitKind::Demolition]);
        g.train("demolition");
        assert_eq!(g.credits, 250.0);
        assert_eq!(g.factory_queue.len(), 1);
        g.ai_decision_timer = 1000.0;
        for _ in 0..119 {
            g.update(0.05);
        }
        assert!(!g.units.iter().any(|u| u.kind == UnitKind::Demolition));
        for _ in 0..2 {
            g.update(0.05);
        }
        assert!(g.factory_queue.is_empty());
        assert!(g.has_demolition(Team::Player));
        let credits = g.credits;
        g.train("demolition");
        g.spawn(Team::Player, UnitKind::Demolition);
        assert_eq!(g.credits, credits);
        assert!(g.factory_queue.is_empty());
        g.spawn(Team::Enemy, UnitKind::Demolition);
        assert_eq!(
            g.units
                .iter()
                .filter(|u| u.kind == UnitKind::Demolition)
                .count(),
            2
        );
        g.units
            .iter_mut()
            .find(|u| u.team == Team::Player && u.kind == UnitKind::Demolition)
            .unwrap()
            .hp = 0.0;
        g.update(0.05);
        g.train("demolition");
        assert_eq!(g.factory_queue, vec![UnitKind::Demolition]);
        assert_eq!(g.credits, credits + 1.2 - 250.0);
    }

    #[test]
    fn demolition_training_requires_factory_money_and_queue_space() {
        let mut g = Game::new();
        g.credits = 249.0;
        g.train("demolition");
        assert!(g.factory_queue.is_empty());
        assert_eq!(g.credits, 249.0);
        g.credits = 500.0;
        g.factory_queue = vec![UnitKind::Tank; QUEUE_LIMIT];
        g.train("demolition");
        assert_eq!(g.factory_queue.len(), QUEUE_LIMIT);
        assert_eq!(g.credits, 500.0);
        g.factory_queue.clear();
        g.buildings
            .retain(|b| b.team != Team::Player || b.kind != BuildingKind::Factory);
        g.train("demolition");
        assert!(g.factory_queue.is_empty());
        assert_eq!(g.credits, 500.0);
    }

    #[test]
    fn demolition_damage_is_fifty_percent_stronger_across_the_same_radius() {
        for (distance, previous_damage) in [
            (0.0, 300.0),
            (2.0, 300.0),
            (3.0, 240.0),
            (4.0, 180.0),
            (6.0, 60.0),
            (7.0, 0.0),
            (8.0, 0.0),
        ] {
            assert!((demolition_damage(distance) - previous_damage * 1.5).abs() < 0.001);
        }
    }

    #[test]
    fn death_blast_hits_both_teams_collectors_and_buildings_with_falloff() {
        let mut g = isolated_units(&[
            (Team::Player, UnitKind::Demolition, 0.0, 0.0),
            (Team::Player, UnitKind::Collector, -3.0, 0.0),
            (Team::Enemy, UnitKind::Collector, 3.0, 0.0),
            (Team::Enemy, UnitKind::Collector, 6.0, 0.0),
            (Team::Player, UnitKind::Collector, -7.0, 0.0),
            (Team::Enemy, UnitKind::Collector, 8.0, 0.0),
        ]);
        g.units[0].hp = 0.0;
        for team in [Team::Player, Team::Enemy] {
            g.add_building(
                team,
                BuildingKind::Factory,
                0.0,
                if team == Team::Player { 5.0 } else { -5.0 },
                1000.0,
            );
        }
        g.add_building(Team::Enemy, BuildingKind::Factory, 14.0, 0.0, 1000.0);
        g.combat_and_move(0.05);
        assert_eq!(g.explosions.len(), 1);
        assert_eq!(g.explosions[0].radius, DEMOLITION_RADIUS);
        assert!(g.units[1].hp <= 0.0 && g.units[2].hp <= 0.0);
        assert_eq!(g.units[3].hp, 130.0);
        assert_eq!(g.units[4].hp, 220.0);
        assert_eq!(g.units[5].hp, 220.0);
        assert_eq!(g.buildings[0].hp, 550.0);
        assert_eq!(g.buildings[1].hp, 550.0);
        assert_eq!(g.buildings[2].hp, 1000.0);
        let deaths = (g.player_kills, g.enemy_kills);
        g.combat_and_move(0.05);
        assert_eq!(g.explosions.len(), 1, "a corpse must not explode again");
        assert_eq!((g.player_kills, g.enemy_kills), deaths);
    }

    #[test]
    fn friendly_factory_destroyed_by_blast_loses_production_and_events_expire() {
        let mut g = isolated_units(&[
            (Team::Player, UnitKind::Demolition, 4.8, 0.0),
            (Team::Enemy, UnitKind::Collector, 15.0, 0.0),
        ]);
        g.add_building(Team::Player, BuildingKind::Factory, 0.0, 0.0, 200.0);
        g.add_building(Team::Player, BuildingKind::Barracks, -15.0, 20.0, 800.0);
        g.units[0].hp = 0.0;
        g.factory_queue.push(UnitKind::Tank);
        g.factory_progress = 0.5;
        g.ai_decision_timer = 1000.0;
        g.update(0.05);
        assert!(!g.alive_building(Team::Player, BuildingKind::Factory));
        assert!(g.factory_queue.is_empty());
        assert_eq!(g.factory_progress, 0.0);
        assert_eq!(g.explosions.len(), 1);
        for _ in 0..21 {
            g.update(0.05);
        }
        assert!(g.explosions.is_empty());
    }

    #[test]
    fn attack_and_lethal_hit_detonate_once_and_do_not_emit_a_projectile() {
        let mut g = isolated_units(&[
            (Team::Player, UnitKind::Demolition, 0.0, 0.0),
            (Team::Enemy, UnitKind::Tank, 3.0, 0.0),
        ]);
        g.units[0].hp = 1.0;
        g.combat_and_move(0.05);
        assert!(g.units[0].hp <= 0.0);
        assert!(
            g.units[1].hp <= 0.0,
            "the stronger blast kills a tank at close range"
        );
        assert_eq!(g.explosions.len(), 1);
        assert!(g.shots.iter().all(|shot| shot.kind != UnitKind::Demolition));
    }

    #[test]
    fn blast_chains_to_opposing_truck_once_and_reaches_units_beyond_first_radius() {
        let mut g = isolated_units(&[
            (Team::Player, UnitKind::Demolition, 0.0, 0.0),
            (Team::Enemy, UnitKind::Demolition, 4.0, 0.0),
            (Team::Player, UnitKind::Collector, 8.0, 0.0),
        ]);
        g.units[0].hp = 0.0;
        g.combat_and_move(0.05);
        assert!(g.units[1].hp <= 0.0);
        assert_eq!(g.explosions.len(), 2);
        assert!(g.units[2].hp <= 0.0);
        g.combat_and_move(0.05);
        assert_eq!(g.explosions.len(), 2);
    }

    #[test]
    fn demolition_reaches_each_structure_footprint_without_stalling() {
        for kind in [
            BuildingKind::Command,
            BuildingKind::Barracks,
            BuildingKind::Factory,
            BuildingKind::Refinery,
        ] {
            for (x, z) in [(12.0, 0.0), (0.0, 12.0), (12.0, 12.0)] {
                let mut g = isolated_units(&[(Team::Player, UnitKind::Demolition, x, z)]);
                g.units[0].state = UnitState::Attack;
                g.add_building(Team::Enemy, kind, 0.0, 0.0, 1000.0);
                g.buildings[0].cooldown = 1000.0;
                for _ in 0..180 {
                    g.combat_and_move(0.05);
                    g.resolve_collisions();
                    if !g.explosions.is_empty() {
                        break;
                    }
                }
                assert_eq!(
                    g.explosions.len(),
                    1,
                    "truck stalled approaching {kind:?} from {x}, {z}"
                );
                assert!((549.9..=551.0).contains(&g.buildings[0].hp));
            }
        }
    }

    #[test]
    fn demolition_balance_rewards_clusters_but_rockets_stop_an_unsupported_charge() {
        // A 250-credit truck can beat 300 credits of tightly clustered rifles.
        let mut g = isolated_units(&[
            (Team::Player, UnitKind::Demolition, 0.0, 0.0),
            (Team::Enemy, UnitKind::Soldier, -2.0, -2.0),
            (Team::Enemy, UnitKind::Soldier, 0.0, -2.0),
            (Team::Enemy, UnitKind::Soldier, 2.0, -2.0),
            (Team::Enemy, UnitKind::Soldier, -1.0, -4.0),
            (Team::Enemy, UnitKind::Soldier, 1.0, -4.0),
        ]);
        g.combat_and_move(0.05);
        assert!(g.units.iter().all(|u| u.hp <= 0.0));
        // 270 credits of rockets get two volleys before the truck can close.
        let mut g = isolated_units(&[
            (Team::Player, UnitKind::Demolition, 0.0, 10.0),
            (Team::Enemy, UnitKind::Rocket, -2.5, 0.0),
            (Team::Enemy, UnitKind::Rocket, 0.0, 0.0),
            (Team::Enemy, UnitKind::Rocket, 2.5, 0.0),
        ]);
        g.units[0].state = UnitState::Attack;
        for _ in 0..100 {
            g.combat_and_move(0.05);
            g.resolve_collisions();
            if g.units[0].hp <= 0.0 {
                break;
            }
        }
        assert!(g.units[0].hp <= 0.0);
        assert!(
            g.units[1..].iter().all(|u| u.hp > 0.0),
            "ranged counters must survive the death blast"
        );
        assert!(
            demolition_damage(2.0) < 800.0,
            "even the weakest starting structure survives"
        );
    }

    #[test]
    fn ai_fields_limited_demolition_trucks_and_counters_player_trucks() {
        let mut g = Game::new();
        for _ in 0..3 {
            g.spawn(Team::Player, UnitKind::Soldier);
        }
        g.time = 35.0;
        g.ai_wave_timer = 1000.0;
        g.spawn(Team::Enemy, UnitKind::Collector);
        g.spawn(Team::Enemy, UnitKind::Collector);
        g.ai_credits = 800.0;
        g.ai_decide();
        assert_eq!(g.enemy_factory_queue, vec![UnitKind::Demolition]);
        g.ai_decide();
        assert_eq!(g.enemy_factory_queue, vec![UnitKind::Demolition]);
        g.enemy_factory_queue.clear();
        g.spawn(Team::Enemy, UnitKind::Demolition);
        g.ai_credits = 800.0;
        g.ai_decide();
        assert!(!g.enemy_factory_queue.contains(&UnitKind::Demolition));
        let mut g = Game::new();
        g.spawn(Team::Player, UnitKind::Demolition);
        g.ai_decide();
        assert_eq!(g.enemy_barracks_queue.first(), Some(&UnitKind::Rocket));
    }

    #[test]
    fn every_weapon_records_actual_target_even_on_lethal_hit() {
        for kind in [UnitKind::Soldier, UnitKind::Rocket, UnitKind::Tank] {
            let mut g = Game::new();
            g.units.clear();
            g.buildings.clear();
            g.spawn(Team::Player, kind);
            g.spawn(Team::Enemy, UnitKind::Soldier);
            g.units[0].x = 0.0;
            g.units[0].z = 0.0;
            g.units[0].cooldown = 0.0;
            g.units[1].x = 3.0;
            g.units[1].z = 0.0;
            g.units[1].hp = 1.0;
            g.units[1].cooldown = 10.0;
            let source_id = g.units[0].id;
            g.combat_and_move(0.05);
            assert!(g.units[1].hp <= 0.0);
            assert_eq!(g.shots.len(), 1);
            let shot = &g.shots[0];
            assert_eq!(shot.source_id, source_id);
            assert!(shot.source_is_unit);
            assert_eq!(shot.kind, kind);
            assert_eq!(
                (shot.x, shot.z, shot.target_x, shot.target_z),
                (0.0, 0.0, 3.0, 0.0)
            );
            g.combat_and_move(0.05);
            assert_eq!(g.shots.len(), 1, "cooldown prevents duplicate shots");
        }
    }
    #[test]
    fn shots_include_building_targets_and_command_defense() {
        let mut g = Game::new();
        g.units.clear();
        g.buildings.clear();
        g.spawn(Team::Player, UnitKind::Rocket);
        g.units[0].x = 0.0;
        g.units[0].z = 0.0;
        g.units[0].cooldown = 0.0;
        g.add_building(Team::Enemy, BuildingKind::Command, 5.0, 0.0, 1400.0);
        g.buildings[0].cooldown = 0.0;
        g.combat_and_move(0.05);
        assert_eq!(g.shots.len(), 2);
        let attack = &g.shots[0];
        assert_eq!(
            (attack.target_x, attack.target_y, attack.target_z),
            (5.0, 2.0, 0.0)
        );
        let defense = &g.shots[1];
        assert!(!defense.source_is_unit);
        assert_eq!(defense.source_id, g.buildings[0].id);
        assert_eq!((defense.x, defense.source_y, defense.z), (5.0, 4.4, 0.0));
        assert_eq!((defense.target_x, defense.target_z), (0.0, 0.0));
        assert!(defense.id > attack.id);
    }
    #[test]
    fn collectors_never_emit_shots_and_old_events_expire() {
        let mut g = Game::new();
        g.units.clear();
        g.spawn(Team::Player, UnitKind::Collector);
        g.spawn(Team::Enemy, UnitKind::Collector);
        for unit in &mut g.units {
            unit.x = 0.0;
            unit.z = 0.0;
            unit.cooldown = 0.0;
        }
        g.combat_and_move(0.05);
        assert!(g.shots.is_empty());
        g.units[0].kind = UnitKind::Soldier;
        g.combat_and_move(0.05);
        assert_eq!(g.shots.len(), 1);
        g.shots[0].time = -2.0;
        g.units[0].kind = UnitKind::Collector;
        g.update(0.05);
        assert!(g.shots.is_empty());
    }
    use super::*;
    #[test]
    fn gathering_unit_routes_around_building_and_stationary_unit() {
        let mut g = Game::new();
        g.units.clear();
        g.buildings.clear();
        g.add_building(Team::Player, BuildingKind::Factory, 0.0, 0.0, 1000.0);
        g.spawn(Team::Player, UnitKind::Soldier);
        g.spawn(Team::Player, UnitKind::Tank);
        g.units[0].x = 0.0;
        g.units[0].z = -10.0;
        g.units[0].rally_x = 0.0;
        g.units[0].rally_z = 12.0;
        g.units[1].x = 4.0;
        g.units[1].z = 0.0;
        g.units[1].rally_x = 4.0;
        g.units[1].rally_z = 0.0;
        for _ in 0..240 {
            g.combat_and_move(0.05);
            g.resolve_collisions();
        }
        let unit = &g.units[0];
        assert!(
            distance_sq(unit.x, unit.z, 0.0, 12.0) < 1.0,
            "unit failed to reach rally: {}, {}",
            unit.x,
            unit.z
        );
    }

    #[test]
    fn units_passing_in_opposite_directions_do_not_deadlock() {
        let mut g = Game::new();
        g.units.clear();
        g.buildings.clear();
        for _ in 0..2 {
            g.spawn(Team::Player, UnitKind::Tank);
        }
        g.units[0].x = 0.0;
        g.units[0].z = -9.0;
        g.units[0].rally_x = 0.0;
        g.units[0].rally_z = 9.0;
        g.units[1].x = 0.0;
        g.units[1].z = 9.0;
        g.units[1].rally_x = 0.0;
        g.units[1].rally_z = -9.0;
        for _ in 0..240 {
            g.combat_and_move(0.05);
            g.resolve_collisions();
        }
        assert!(
            g.units[0].z > 7.0 && g.units[1].z < -7.0,
            "units stalled: ({}, {}), ({}, {})",
            g.units[0].x,
            g.units[0].z,
            g.units[1].x,
            g.units[1].z
        );
    }

    #[test]
    fn attacking_unit_routes_around_friendly_building() {
        let mut g = Game::new();
        g.units.clear();
        g.buildings.clear();
        g.add_building(Team::Player, BuildingKind::Command, 0.0, 0.0, 1400.0);
        g.add_building(Team::Enemy, BuildingKind::Factory, 0.0, 24.0, 1000.0);
        g.spawn(Team::Player, UnitKind::Soldier);
        g.units[0].state = UnitState::Attack;
        g.units[0].x = 0.0;
        g.units[0].z = -12.0;
        for _ in 0..220 {
            g.combat_and_move(0.05);
            g.resolve_collisions();
        }
        assert!(
            g.buildings[1].hp < g.buildings[1].max_hp,
            "unit did not reach firing range: {}, {}",
            g.units[0].x,
            g.units[0].z
        );
    }

    #[test]
    fn collision_separates_all_units_and_building_footprints() {
        let mut g = Game::new();
        g.units.clear();
        g.spawn(Team::Player, UnitKind::Collector);
        g.spawn(Team::Enemy, UnitKind::Tank);
        for unit in &mut g.units {
            unit.x = 0.0;
            unit.z = 39.0;
        }
        g.resolve_collisions();
        let a = &g.units[0];
        let b = &g.units[1];
        assert!(
            distance_sq(a.x, a.z, b.x, b.z).sqrt() >= a.kind.radius() + b.kind.radius() - 0.001
        );
        for unit in &g.units {
            let dx = (unit.x.abs() - 3.65).max(0.0);
            let dz = ((unit.z - 43.0).abs() - 3.3).max(0.0);
            assert!((dx * dx + dz * dz).sqrt() >= unit.kind.radius() - 0.001);
        }
    }

    #[test]
    fn collectors_on_both_teams_make_repeated_deliveries_in_traffic() {
        let mut g = Game::new();
        g.units.clear();
        for team in [Team::Player, Team::Enemy] {
            g.spawn(team, UnitKind::Collector);
            g.spawn(team, UnitKind::Collector);
        }
        g.resolve_collisions();
        g.credits = 0.0;
        g.ai_credits = 0.0;
        for _ in 0..2400 {
            g.harvest_and_unload(0.05);
            g.resolve_collisions();
        }
        assert!(
            g.credits >= 200.0,
            "player collectors delivered {}",
            g.credits
        );
        assert!(
            g.ai_credits >= 200.0,
            "enemy collectors delivered {}",
            g.ai_credits
        );
    }

    #[test]
    fn collector_escapes_building_contact_after_unloading() {
        for team in [Team::Player, Team::Enemy] {
            let mut g = Game::with_seed(26);
            g.units.clear();
            g.spawn(team, UnitKind::Collector);
            // A position reached after unloading between the command center,
            // factory and refinery. Collision resolution used to pin it here.
            g.units[0].x = 5.2535853;
            g.units[0].z = if team == Team::Player {
                46.688587
            } else {
                -46.688587
            };
            for _ in 0..200 {
                g.harvest_and_unload(0.05);
                g.resolve_collisions();
            }
            let u = &g.units[0];
            assert!(u.cargo > 0.0, "collector stalled at ({}, {})", u.x, u.z);
        }
    }

    #[test]
    fn collectors_keep_delivering_across_seeded_ore_layouts() {
        // Seeds 5 and 26 reproduce stalls at the command center and refinery;
        // keep additional layouts here without making the regular suite slow.
        for seed in [0, 5, 26, 73] {
            let mut g = Game::with_seed(seed);
            for team in [Team::Player, Team::Enemy] {
                for _ in 0..4 {
                    g.spawn(team, UnitKind::Collector);
                }
            }
            g.resolve_collisions();
            let mut deliveries = vec![0; g.units.len()];
            let mut last_delivery = vec![0; g.units.len()];
            for step in 0..3600 {
                let cargo: Vec<_> = g.units.iter().map(|u| u.cargo).collect();
                g.harvest_and_unload(0.05);
                g.resolve_collisions();
                for (i, u) in g.units.iter().enumerate() {
                    if cargo[i] > 0.0 && u.cargo == 0.0 {
                        deliveries[i] += 1;
                        last_delivery[i] = step;
                    }
                }
            }
            for (i, u) in g
                .units
                .iter()
                .enumerate()
                .filter(|(_, u)| u.kind == UnitKind::Collector)
            {
                assert!(deliveries[i] >= 2 && last_delivery[i] > 2400,
                    "seed {seed}: {:?} collector {} stalled at ({}, {}), cargo {}, returning {}, deliveries {}",
                    u.team, u.id, u.x, u.z, u.cargo, u.returning, deliveries[i]);
            }
        }
    }

    #[test]
    fn collector_can_deliver_with_collisions_enabled() {
        let mut g = Game::new();
        g.units.clear();
        g.spawn(Team::Player, UnitKind::Collector);
        g.credits = 0.0;
        g.ai_decision_timer = 1000.0;
        g.ai_wave_timer = 1000.0;
        for _ in 0..800 {
            g.update(0.05);
        }
        // Passive income is 960 credits; a delivery adds up to 100.
        assert!(
            g.credits > 1000.0,
            "collector must complete a delivery: {}, position {}, {}, cargo {}",
            g.credits,
            g.units[0].x,
            g.units[0].z,
            g.units[0].cargo
        );
    }

    #[test]
    fn ore_is_seeded_symmetric_and_clear_of_starting_buildings() {
        for seed in 0..128 {
            let g = Game::with_seed(seed);
            assert_eq!(g.ore.len(), 12);
            for pair in g.ore.chunks_exact(2) {
                assert_eq!(pair[0].x, -pair[1].x);
                assert_eq!(pair[0].z, -pair[1].z);
                assert_eq!(pair[0].amount, pair[1].amount);
                assert!((1400.0..=2200.0).contains(&pair[0].amount));
            }
            for ore in &g.ore {
                assert!(ore.x.abs() <= FIELD_EDGE - 2.5);
                assert!(ore.x.abs() >= 8.0);
                for b in &g.buildings {
                    assert!(distance_sq(ore.x, ore.z, b.x, b.z) > 7.0 * 7.0);
                }
                for other in &g.ore {
                    if ore.id != other.id {
                        assert!(distance_sq(ore.x, ore.z, other.x, other.z) > 5.0 * 5.0);
                    }
                }
            }
        }
        let a = Game::with_seed(12);
        let b = Game::with_seed(13);
        let repeat = Game::with_seed(12);
        assert_ne!(a.ore[0].x, b.ore[0].x);
        assert_eq!(a.ore[0].x, repeat.ore[0].x);
        assert_eq!(a.ore[0].amount, repeat.ore[0].amount);
    }
    #[test]
    fn both_teams_start_with_a_refinery() {
        let g = Game::new();
        for team in [Team::Player, Team::Enemy] {
            assert!(g.alive_building(team, BuildingKind::Refinery));
            assert_eq!(g.buildings.iter().filter(|b| b.team == team).count(), 4);
        }
    }
    #[test]
    fn collectors_use_the_factory_and_ignore_army_orders() {
        let mut g = Game::new();
        g.set_mode("attack");
        g.train("collector");
        assert_eq!(g.credits, 300.0);
        assert_eq!(g.factory_queue, vec![UnitKind::Collector]);
        for _ in 0..110 {
            g.update(0.05);
        }
        let id = g
            .units
            .iter()
            .find(|u| u.team == Team::Player && u.kind == UnitKind::Collector)
            .unwrap()
            .id;
        g.set_mode("attack");
        g.attack_selected(&[id]);
        g.set_mode("gather");
        assert_eq!(
            g.units.iter().find(|u| u.id == id).unwrap().state,
            UnitState::Harvest
        );
    }
    #[test]
    fn collector_training_checks_refinery_factory_credits_and_queue() {
        for missing in [BuildingKind::Refinery, BuildingKind::Factory] {
            let mut g = Game::new();
            g.buildings
                .retain(|b| !(b.team == Team::Player && b.kind == missing));
            g.train("collector");
            assert!(g.factory_queue.is_empty());
            assert_eq!(g.credits, 500.0);
        }
        let mut g = Game::new();
        g.credits = 199.0;
        g.train("collector");
        assert!(g.factory_queue.is_empty());
        assert_eq!(g.credits, 199.0);
        g.credits = 500.0;
        g.factory_queue = vec![UnitKind::Tank; QUEUE_LIMIT];
        g.train("collector");
        assert_eq!(g.factory_queue.len(), QUEUE_LIMIT);
        assert_eq!(g.credits, 500.0);
        g.factory_queue.clear();
        g.outcome = Outcome::Defeat;
        g.train("collector");
        assert!(g.factory_queue.is_empty());
    }
    #[test]
    fn collectors_mine_and_deliver_without_creating_ore() {
        let mut g = Game::new();
        g.credits = 0.0;
        g.spawn(Team::Player, UnitKind::Collector);
        let initial_ore: f32 = g.ore.iter().map(|o| o.amount).sum();
        for _ in 0..1200 {
            g.harvest_and_unload(0.05);
        }
        let collector = g
            .units
            .iter()
            .find(|u| u.kind == UnitKind::Collector)
            .unwrap();
        let remaining_ore: f32 = g.ore.iter().map(|o| o.amount).sum();
        assert!(g.credits >= 200.0, "must complete multiple round trips");
        assert!((initial_ore - remaining_ore - g.credits - collector.cargo).abs() < 0.1);
        assert!((0.0..=COLLECTOR_CAPACITY).contains(&collector.cargo));
        assert!(g.ore.iter().all(|o| o.amount >= 0.0));
    }
    #[test]
    fn collectors_deliver_partial_loads_after_depletion_and_stop_without_refinery() {
        let mut g = Game::new();
        g.credits = 0.0;
        g.ore.truncate(1);
        g.ore[0].amount = 12.0;
        g.spawn(Team::Player, UnitKind::Collector);
        let collector = g.units.last_mut().unwrap();
        collector.x = g.ore[0].x;
        collector.z = g.ore[0].z;
        for _ in 0..400 {
            g.harvest_and_unload(0.05);
        }
        assert_eq!(g.credits, 12.0);
        assert_eq!(g.ore[0].amount, 0.0);
        assert_eq!(g.units.last().unwrap().cargo, 0.0);
        g.ore[0].amount = 200.0;
        g.buildings
            .retain(|b| !(b.team == Team::Player && b.kind == BuildingKind::Refinery));
        g.units.last_mut().unwrap().cargo = 100.0;
        for _ in 0..400 {
            g.harvest_and_unload(0.05);
        }
        assert_eq!(g.credits, 12.0);
        assert_eq!(g.ore[0].amount, 200.0);
        assert_eq!(g.units.last().unwrap().cargo, 100.0);
    }
    #[test]
    fn collectors_are_unarmed_and_can_be_destroyed() {
        let mut g = Game::new();
        g.units.clear();
        g.spawn(Team::Player, UnitKind::Collector);
        g.spawn(Team::Enemy, UnitKind::Rocket);
        for u in &mut g.units {
            u.x = 0.0;
            u.z = 0.0;
        }
        g.combat_and_move(0.25);
        assert!(g.units[0].hp < g.units[0].max_hp);
        assert_eq!(g.units[1].hp, g.units[1].max_hp);
        for _ in 0..140 {
            g.combat_and_move(0.05);
        }
        assert!(g.units[0].hp <= 0.0);
    }
    #[test]
    fn ai_builds_collectors_and_does_not_treat_them_as_soldiers() {
        let mut g = Game::new();
        g.train("collector");
        g.spawn(Team::Player, UnitKind::Collector);
        g.spawn(Team::Enemy, UnitKind::Collector);
        g.time = 3.0;
        g.ai_credits = 500.0;
        g.ai_decide();
        assert_eq!(g.enemy_factory_queue.first(), Some(&UnitKind::Collector));
        assert!(g
            .units
            .iter()
            .filter(|u| u.kind == UnitKind::Collector)
            .all(|u| u.state == UnitState::Harvest));
        let mut g = Game::new();
        for _ in 0..400 {
            g.update(0.05);
        }
        assert!(g
            .units
            .iter()
            .any(|u| u.team == Team::Enemy && u.kind == UnitKind::Collector));
    }
    #[test]
    fn retreat_recalls_attackers_under_fire_without_recalling_active_collectors() {
        let mut g = isolated_units(&[
            (Team::Player, UnitKind::Tank, 0.0, 0.0),
            (Team::Enemy, UnitKind::Soldier, 0.0, -5.0),
            (Team::Player, UnitKind::Collector, 12.0, 25.0),
        ]);
        g.units[0].rally_z = 27.0;
        g.set_mode("attack");
        let collector = g.units[2].clone();
        g.set_mode("retreat");
        assert_eq!(g.units[0].state, UnitState::Gather);
        assert_eq!(g.units[1].state, UnitState::Gather);
        assert_eq!(g.units[2].state, UnitState::Harvest);
        assert_eq!((g.units[2].x, g.units[2].z), (collector.x, collector.z));
        let id = g.units[0].id;
        g.attack_selected(&[id]);
        assert_eq!(g.units[0].state, UnitState::Gather);
        g.combat_and_move(0.05);
        assert!(
            g.units[0].z > 0.0,
            "retreat must move even with a target in firing range"
        );
        assert!(!g.shots.iter().any(|s| s.source_id == id));
        for _ in 0..120 {
            g.combat_and_move(0.05);
            g.resolve_collisions();
        }
        assert!((g.units[0].z - 27.0).abs() < 1.0);
    }

    #[test]
    fn retreat_holds_completed_production_and_releases_it_in_either_mode() {
        for release in ["gather", "attack"] {
            let mut g = Game::new();
            g.ai_decision_timer = 1000.0;
            g.credits = 2000.0;
            g.set_mode("retreat");
            let first_id = g.next_id;
            for kind in ["soldier", "rocket", "tank", "collector", "demolition"] {
                g.train(kind);
            }
            for _ in 0..320 {
                g.update(0.05);
            }
            let sheltered: Vec<_> = g
                .units
                .iter()
                .filter(|u| u.id >= first_id)
                .cloned()
                .collect();
            assert_eq!(sheltered.len(), 5);
            for u in &sheltered {
                assert_eq!(u.state, UnitState::Garrison);
                assert_eq!(u.hp, u.max_hp);
                assert_eq!(u.cargo, 0.0);
                let host = g
                    .buildings
                    .iter()
                    .find(|b| Some(b.id) == u.garrison)
                    .unwrap();
                assert_eq!(host.kind, u.kind.production_building());
                assert_eq!((u.x, u.z), (host.x, host.z));
            }
            g.set_mode("retreat");
            let ids: Vec<_> = sheltered.iter().map(|u| u.id).collect();
            g.attack_selected(&ids);
            assert!(g
                .units
                .iter()
                .filter(|u| ids.contains(&u.id))
                .all(|u| u.state == UnitState::Garrison));
            g.set_mode(release);
            for u in g.units.iter().filter(|u| ids.contains(&u.id)) {
                assert_eq!(u.garrison, None);
                assert_eq!(
                    u.state,
                    if u.kind == UnitKind::Collector {
                        UnitState::Harvest
                    } else if release == "attack" {
                        UnitState::Attack
                    } else {
                        UnitState::Gather
                    }
                );
                assert_eq!(u.hp, u.max_hp);
                for b in &g.buildings {
                    let (hx, hz) = building_half_size(b.kind);
                    let dx = ((u.x - b.x).abs() - hx).max(0.0);
                    let dz = ((u.z - b.z).abs() - hz).max(0.0);
                    assert!(dx * dx + dz * dz >= (u.kind.radius() - 0.01).powi(2));
                }
            }
            assert_eq!(g.units.iter().filter(|u| ids.contains(&u.id)).count(), 5);
        }
    }

    #[test]
    fn sheltered_units_are_protected_and_lost_only_with_their_own_building() {
        let mut g = Game::new();
        g.units.clear();
        g.set_mode("retreat");
        g.spawn(Team::Player, UnitKind::Soldier);
        g.spawn(Team::Player, UnitKind::Demolition);
        g.spawn(Team::Player, UnitKind::Collector);
        let barracks = g.units[0].garrison.unwrap();
        g.add_building(Team::Enemy, BuildingKind::Command, -10.0, 35.0, 1400.0);
        g.spawn(Team::Enemy, UnitKind::Demolition);
        let truck = g.units.last_mut().unwrap();
        truck.x = -10.0;
        truck.z = 40.0;
        truck.hp = 0.0;
        g.combat_and_move(0.05);
        assert_eq!(
            g.units[0].hp, g.units[0].max_hp,
            "blast must not hit occupants"
        );
        assert!(
            g.shots.is_empty(),
            "sheltered units cannot fire or be targeted by point defense"
        );
        assert_eq!(g.explosions.len(), 1);
        g.buildings
            .iter_mut()
            .find(|b| b.id == barracks)
            .unwrap()
            .hp = 0.0;
        g.combat_and_move(0.05);
        assert_eq!(g.units[0].hp, 0.0);
        assert_eq!(g.units[1].hp, g.units[1].max_hp);
        assert_eq!(g.units[2].hp, g.units[2].max_hp);
        assert_eq!(g.enemy_kills, 1);
        for b in g.buildings.iter_mut().filter(|b| b.team == Team::Player) {
            b.hp = 0.0;
        }
        g.ai_decision_timer = 1000.0;
        g.update(0.05);
        assert_eq!(g.outcome, Outcome::Defeat);
        assert_eq!(
            g.explosions.len(),
            1,
            "a sheltered truck is lost without detonating"
        );
    }

    #[test]
    fn both_ai_commanders_retreat_when_overwhelmed_and_release_regrouped_reserves() {
        for team in [Team::Player, Team::Enemy] {
            let mut g = Game::demo_with_seed(1941);
            let opponent = if team == Team::Player {
                Team::Enemy
            } else {
                Team::Player
            };
            let direction = if team == Team::Player { -1.0 } else { 1.0 };
            for _ in 0..6 {
                g.spawn(opponent, UnitKind::Tank);
            }
            for u in &mut g.units {
                if u.team == opponent {
                    u.state = UnitState::Attack;
                    u.z = -18.0 * direction;
                } else {
                    u.state = UnitState::Attack;
                }
            }
            g.ai_decide_for(team);
            assert_eq!(g.team_mode(team), Mode::Retreat);
            assert!(g
                .units
                .iter()
                .filter(|u| u.team == team)
                .all(|u| u.state == UnitState::Gather));
            g.spawn(team, UnitKind::Tank);
            let reserve_id = g.units.last().unwrap().id;
            assert_eq!(g.units.last().unwrap().state, UnitState::Garrison);
            g.ai_decide_for(team);
            assert_eq!(g.team_mode(team), Mode::Retreat);
            // Rebuilding enough strength should release reserves even while the
            // incoming army remains on our side of the map.
            for _ in 0..7 {
                g.spawn(team, UnitKind::Tank);
            }
            g.ai_decide_for(team);
            assert_eq!(g.team_mode(team), Mode::Gather);
            assert!(g
                .units
                .iter()
                .filter(|u| u.team == team)
                .all(|u| u.state == UnitState::Attack));
            assert!(g
                .units
                .iter()
                .any(|u| u.id == reserve_id && u.garrison.is_none()));
        }
    }

    #[test]
    fn ai_releases_reserves_when_threat_passes_or_production_is_lost() {
        for loses_production in [false, true] {
            let mut g = Game::new();
            g.set_team_mode(Team::Enemy, Mode::Retreat);
            g.spawn(Team::Enemy, UnitKind::Soldier);
            if loses_production {
                for _ in 0..10 {
                    g.spawn(Team::Player, UnitKind::Tank);
                }
                for u in g.units.iter_mut().filter(|u| u.team == Team::Player) {
                    u.state = UnitState::Attack;
                    u.z = -15.0;
                }
                g.buildings
                    .retain(|b| b.team != Team::Enemy || b.kind == BuildingKind::Command);
            }
            g.ai_wave_timer = 0.0;
            g.ai_decide();
            assert_eq!(g.enemy_mode, Mode::Gather);
            assert!(g
                .units
                .iter()
                .filter(|u| u.team == Team::Enemy && u.hp > 0.0)
                .all(|u| u.state == UnitState::Attack));
        }
    }

    #[test]
    fn modes_commit_only_the_correct_units() {
        let mut g = Game::new();
        let player_ids: Vec<_> = g
            .units
            .iter()
            .filter(|u| u.team == Team::Player)
            .map(|u| u.id)
            .collect();
        g.attack_selected(&player_ids[..1]);
        assert_eq!(
            g.units
                .iter()
                .filter(|u| u.team == Team::Player && u.state == UnitState::Attack)
                .count(),
            1
        );
        g.set_mode("attack");
        g.set_mode("gather");
        assert_eq!(
            g.units
                .iter()
                .filter(|u| u.team == Team::Player && u.state == UnitState::Attack)
                .count(),
            player_ids.len()
        );
    }
    #[test]
    fn training_respects_cost_and_mode() {
        let mut g = Game::new();
        g.set_mode("attack");
        g.train("soldier");
        assert_eq!(g.credits, 440.0);
        for _ in 0..42 {
            g.update(0.05);
        }
        assert!(g.units.iter().any(|u| u.id > 14
            && u.team == Team::Player
            && u.kind == UnitKind::Soldier
            && u.state == UnitState::Attack));
    }
    #[test]
    fn ai_produces_rockets_to_counter_a_tank_force() {
        let mut g = Game::new();
        for _ in 0..4 {
            g.spawn(Team::Player, UnitKind::Tank);
        }
        g.ai_decide();
        assert_eq!(g.enemy_barracks_queue.first(), Some(&UnitKind::Rocket));
        assert_eq!(g.ai_status, "COUNTERING YOUR ARMOR");
    }
    #[test]
    fn ai_counters_visible_units_and_deploys_defenders() {
        let mut g = Game::new();
        for _ in 0..4 {
            g.spawn(Team::Player, UnitKind::Tank);
        }
        g.ai_decide();
        assert_eq!(g.enemy_barracks_queue.first(), Some(&UnitKind::Rocket));

        let mut g = Game::new();
        for _ in 0..4 {
            g.spawn(Team::Player, UnitKind::Rocket);
        }
        g.ai_decide();
        assert_eq!(g.enemy_barracks_queue.first(), Some(&UnitKind::Soldier));
        assert!(
            g.enemy_factory_queue.is_empty(),
            "avoid extra tanks against rocket troops"
        );

        let mut g = Game::new();
        for _ in 0..6 {
            g.spawn(Team::Player, UnitKind::Soldier);
        }
        g.ai_decide();
        assert_eq!(g.enemy_factory_queue.first(), Some(&UnitKind::Tank));

        let mut g = Game::new();
        let intruder = g.units.iter_mut().find(|u| u.team == Team::Player).unwrap();
        intruder.state = UnitState::Attack;
        intruder.z = -15.0;
        g.ai_decide();
        assert!(g
            .units
            .iter()
            .filter(|u| u.team == Team::Enemy)
            .all(|u| u.state == UnitState::Attack));
        assert_eq!(g.ai_status, "INTERCEPTING YOUR ADVANCE");
    }
    #[test]
    fn ai_respects_its_economy() {
        let mut g = Game::new();
        g.ai_credits = 0.0;
        g.ai_decide();
        assert!(g.enemy_barracks_queue.is_empty());
        assert!(g.enemy_factory_queue.is_empty());
    }
    #[test]
    fn victory_and_defeat_require_all_units_and_buildings_to_be_gone() {
        let mut g = Game::new();
        g.buildings.retain(|b| b.team == Team::Player);
        g.update(0.05);
        assert_eq!(g.outcome, Outcome::Playing);
        g.units.retain(|u| u.team == Team::Player);
        g.update(0.05);
        assert_eq!(g.outcome, Outcome::Victory);
        let mut g = Game::new();
        g.units.retain(|u| u.team == Team::Enemy);
        g.buildings.retain(|b| b.team == Team::Enemy);
        g.update(0.05);
        assert_eq!(g.outcome, Outcome::Defeat);
    }
    #[test]
    fn destroyed_factory_cannot_train() {
        let mut g = Game::new();
        g.buildings
            .retain(|b| !(b.team == Team::Player && b.kind == BuildingKind::Factory));
        g.train("tank");
        assert!(g.factory_queue.is_empty());
        assert_eq!(g.credits, 500.0);
    }
}
