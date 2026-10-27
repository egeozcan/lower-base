//! Short-lived routes around buildings and other units. Collision resolution remains
//! responsible for physical contact when an obstacle moves after a route is planned.
use super::{building_half_size, distance_sq, Building, Unit, FIELD_EDGE};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

const CELL: f32 = 1.0;
const WIDTH: i32 = 35;
const HEIGHT: i32 = 131;
const MIN_Z: f32 = -65.0;
// Reach past a building corner when contact blocks the adjacent grid cells.
const ESCAPE_CELLS: i32 = 6;

#[derive(Clone, Default)]
pub(super) struct Navigation {
    path: Vec<(f32, f32)>,
    goal: (f32, f32),
    retry: f32,
}

#[derive(Clone, Copy)]
struct Entry {
    index: usize,
    score: f32,
}
impl Eq for Entry {}
impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.index == other.index && self.score == other.score
    }
}
impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .score
            .total_cmp(&self.score)
            .then_with(|| other.index.cmp(&self.index))
    }
}
impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn position(index: usize) -> (f32, f32) {
    (
        (index as i32 % WIDTH) as f32 * CELL - FIELD_EDGE,
        (index as i32 / WIDTH) as f32 * CELL + MIN_Z,
    )
}
fn index(x: i32, z: i32) -> usize {
    (z * WIDTH + x) as usize
}
fn grid(point: (f32, f32)) -> (i32, i32) {
    (
        ((point.0 + FIELD_EDGE) / CELL)
            .round()
            .clamp(0.0, (WIDTH - 1) as f32) as i32,
        ((point.1 - MIN_Z) / CELL)
            .round()
            .clamp(0.0, (HEIGHT - 1) as f32) as i32,
    )
}

fn clear(point: (f32, f32), unit: &Unit, units: &[Unit], buildings: &[Building]) -> bool {
    if point.0 < -FIELD_EDGE || point.0 > FIELD_EDGE {
        return false;
    }
    let radius = unit.kind.radius() + 0.12;
    for b in buildings.iter().filter(|b| b.hp > 0.0) {
        let (hx, hz) = building_half_size(b.kind);
        let dx = ((point.0 - b.x).abs() - hx).max(0.0);
        let dz = ((point.1 - b.z).abs() - hz).max(0.0);
        if dx * dx + dz * dz < radius * radius {
            return false;
        }
    }
    for other in units
        .iter()
        .filter(|other| other.id != unit.id && other.on_field())
    {
        let separation = radius + other.kind.radius();
        if distance_sq(point.0, point.1, other.x, other.z) < separation * separation {
            return false;
        }
    }
    true
}

fn line_clear(
    from: (f32, f32),
    to: (f32, f32),
    unit: &Unit,
    units: &[Unit],
    buildings: &[Building],
) -> bool {
    let length = distance_sq(from.0, from.1, to.0, to.1).sqrt();
    let steps = (length / 0.4).ceil().max(1.0) as usize;
    // A unit can already be touching an obstacle. Permit it to leave that
    // contact before requiring the rest of the route to be clear.
    let mut escaped = clear(from, unit, units, buildings);
    let mut overlap = if escaped {
        0.0
    } else {
        contact_depth(from, unit, units, buildings)
    };
    for i in 1..=steps {
        let t = i as f32 / steps as f32;
        let p = (from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t);
        if clear(p, unit, units, buildings) {
            escaped = true;
        } else if escaped {
            return false;
        } else {
            let next_overlap = contact_depth(p, unit, units, buildings);
            // Leaving contact must make progress out of the obstacle. Allowing
            // an initially blocked segment to cross it pins the unit against
            // the wall again every time collisions are resolved.
            if next_overlap > overlap + 0.001 {
                return false;
            }
            overlap = next_overlap;
        }
    }
    escaped
}

fn contact_depth(point: (f32, f32), unit: &Unit, units: &[Unit], buildings: &[Building]) -> f32 {
    let radius = unit.kind.radius() + 0.12;
    let mut depth: f32 = 0.0;
    for b in buildings.iter().filter(|b| b.hp > 0.0) {
        let (hx, hz) = building_half_size(b.kind);
        let dx = ((point.0 - b.x).abs() - hx).max(0.0);
        let dz = ((point.1 - b.z).abs() - hz).max(0.0);
        depth = depth.max(radius - (dx * dx + dz * dz).sqrt());
    }
    for other in units
        .iter()
        .filter(|other| other.id != unit.id && other.on_field())
    {
        depth = depth.max(
            radius + other.kind.radius() - distance_sq(point.0, point.1, other.x, other.z).sqrt(),
        );
    }
    depth
}

fn route(
    unit: &Unit,
    goal: (f32, f32),
    stop: f32,
    units: &[Unit],
    buildings: &[Building],
) -> Vec<(f32, f32)> {
    let (sx, sz) = grid((unit.x, unit.z));
    let start = index(sx, sz);
    let count = (WIDTH * HEIGHT) as usize;
    let mut costs = vec![f32::INFINITY; count];
    let mut parents = vec![usize::MAX; count];
    let mut open = BinaryHeap::new();
    let heuristic = |p: (f32, f32)| (distance_sq(p.0, p.1, goal.0, goal.1).sqrt() - stop).max(0.0);
    costs[start] = 0.0;
    let from = (unit.x, unit.z);
    if clear(from, unit, units, buildings) && clear(position(start), unit, units, buildings) {
        open.push(Entry {
            index: start,
            score: heuristic(from),
        });
    } else {
        // Contact can leave the rounded start cell and all its immediate
        // neighbors blocked by the navigation margin. Connect the actual
        // position to nearby clear cells through a verified escape segment.
        for z in (sz - ESCAPE_CELLS).max(0)..=(sz + ESCAPE_CELLS).min(HEIGHT - 1) {
            for x in (sx - ESCAPE_CELLS).max(0)..=(sx + ESCAPE_CELLS).min(WIDTH - 1) {
                let next = index(x, z);
                let q = position(next);
                if next == start
                    || !clear(q, unit, units, buildings)
                    || !line_clear(from, q, unit, units, buildings)
                {
                    continue;
                }
                let cost = distance_sq(from.0, from.1, q.0, q.1).sqrt();
                costs[next] = cost;
                parents[next] = start;
                open.push(Entry {
                    index: next,
                    score: cost + heuristic(q),
                });
            }
        }
    }
    let mut best = start;
    let mut best_h = heuristic((unit.x, unit.z));
    let mut expanded = 0;
    while let Some(Entry {
        index: current,
        score,
    }) = open.pop()
    {
        let p = position(current);
        if score > costs[current] + heuristic(p) + 0.001 && current != start {
            continue;
        }
        let h = heuristic(p);
        if h < best_h {
            best_h = h;
            best = current;
        }
        if h <= 0.35 {
            best = current;
            break;
        }
        expanded += 1;
        if expanded > 3500 {
            break;
        }
        let cx = current as i32 % WIDTH;
        let cz = current as i32 / WIDTH;
        for (dx, dz) in [
            (-1, 0),
            (1, 0),
            (0, -1),
            (0, 1),
            (-1, -1),
            (-1, 1),
            (1, -1),
            (1, 1),
        ] {
            let (x, z) = (cx + dx, cz + dz);
            if !(0..WIDTH).contains(&x) || !(0..HEIGHT).contains(&z) {
                continue;
            }
            let next = index(x, z);
            let q = position(next);
            if !clear(q, unit, units, buildings) {
                continue;
            }
            // For diagonal steps, don't cut through the corner of an obstacle.
            if dx != 0
                && dz != 0
                && (!clear(position(index(cx + dx, cz)), unit, units, buildings)
                    || !clear(position(index(cx, cz + dz)), unit, units, buildings))
            {
                continue;
            }
            let cost = costs[current]
                + if dx != 0 && dz != 0 {
                    std::f32::consts::SQRT_2
                } else {
                    1.0
                };
            if cost < costs[next] {
                costs[next] = cost;
                parents[next] = current;
                open.push(Entry {
                    index: next,
                    score: cost + heuristic(q),
                });
            }
        }
    }
    let mut path = Vec::new();
    while best != start && best != usize::MAX {
        path.push(position(best));
        best = parents[best];
    }
    path.reverse();
    path
}

pub(super) fn move_toward(
    unit: &mut Unit,
    goal: (f32, f32),
    stop: f32,
    dt: f32,
    units: &[Unit],
    buildings: &[Building],
) {
    let from = (unit.x, unit.z);
    let distance = distance_sq(from.0, from.1, goal.0, goal.1).sqrt();
    if distance <= stop + 0.01 {
        unit.navigation.path.clear();
        return;
    }
    let direct = (
        goal.0 + (from.0 - goal.0) * stop / distance,
        goal.1 + (from.1 - goal.1) * stop / distance,
    );
    unit.navigation.retry -= dt;
    if line_clear(from, direct, unit, units, buildings) {
        unit.navigation.path.clear();
    } else if unit.navigation.retry <= 0.0
        || distance_sq(
            goal.0,
            goal.1,
            unit.navigation.goal.0,
            unit.navigation.goal.1,
        ) > 4.0
    {
        unit.navigation.path = route(unit, goal, stop, units, buildings);
        unit.navigation.goal = goal;
        unit.navigation.retry = 0.7 + (unit.id % 5) as f32 * 0.04;
    }
    while unit
        .navigation
        .path
        .first()
        .is_some_and(|p| distance_sq(from.0, from.1, p.0, p.1) < 0.45 * 0.45)
    {
        unit.navigation.path.remove(0);
    }
    let target = unit.navigation.path.first().copied().unwrap_or(direct);
    let d = distance_sq(from.0, from.1, target.0, target.1).sqrt();
    if d > 0.001 {
        let travel = (unit.kind.speed() * dt).min(d);
        unit.x = (unit.x + (target.0 - from.0) / d * travel).clamp(-FIELD_EDGE, FIELD_EDGE);
        unit.z += (target.1 - from.1) / d * travel;
    }
}
