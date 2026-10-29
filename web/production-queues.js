import { Vector3 } from './three.module.js';

const units = {
  soldier: { name: 'Rifle infantry', cost: 60, art: '<circle cx="12" cy="7" r="3"/><path d="M6 20v-5a6 6 0 0 1 12 0v5M6 17l13-7"/>' },
  rocket: { name: 'Rocket trooper', cost: 90, art: '<path d="m6 18 9-12 4 3-9 12zM15 6l5-3-1 6M5 14l-2 6 6-1"/>' },
  tank: { name: 'Siege tank', cost: 150, art: '<rect x="3" y="12" width="18" height="8" rx="3"/><path d="M8 12V8h8v4M12 8V3M6 16h12"/>' },
  collector: { name: 'Ore collector', cost: 200, art: '<path d="M3 10h12v8H3zM15 12h4l2 3v3h-6M6 6l4-3 4 3-4 3z"/><circle cx="6" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>' },
  demolition: { name: 'Demolition truck', cost: 250, art: '<path d="M3 12h5v7H3zM8 9h13v10H8M15 3l-3 7h5l-3 6"/><circle cx="6" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>' },
};

// Screen-space buttons stay readable and clickable as the camera changes.
export class ProductionQueues {
  constructor(container, onCancel, onEject) {
    this.layer = document.createElement('div');
    this.layer.className = 'building-queues';
    container.append(this.layer);
    this.grids = new Map();
    this.anchor = new Vector3();
    this.onCancel = onCancel;
    this.onEject = onEject;
  }

  reset() {
    this.layer.replaceChildren();
    this.grids.clear();
  }

  update(snapshot, camera, width, height) {
    const alive = new Set();
    for (const building of snapshot.buildings) {
      if (building.team !== 'player' || !['barracks', 'factory'].includes(building.kind) || building.hp <= 0) continue;
      const queue = snapshot[`${building.kind}_queue`];
      const occupants = snapshot.units.filter(u => u.team === building.team && u.hp > 0 && u.state === 'garrison' && u.garrison === building.id);
      const slots = [
        ...occupants.map(u => ({ kind: u.kind, id: u.id })),
        ...queue.map((kind, index) => ({ kind, index })),
      ];
      if (!slots.length) continue;
      alive.add(building.id);
      let grid = this.grids.get(building.id);
      if (!grid) {
        grid = document.createElement('div');
        grid.className = 'building-queue';
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', `${building.kind} production queue`);
        this.grids.set(building.id, grid);
        this.layer.append(grid);
      }
      // Keep existing buttons through frame updates so taps and focus survive.
      while (grid.children.length > slots.length) grid.lastElementChild.remove();
      slots.forEach(({ kind, id, index }, slot) => {
        const unit = units[kind];
        const garrisoned = id !== undefined;
        let button = grid.children[slot];
        if (!button) {
          button = document.createElement('button');
          button.type = 'button';
          button.className = 'queue-unit';
          button.addEventListener('click', () => {
            if (button.dataset.unitId) this.onEject(Number(button.dataset.unitId));
            else this.onCancel(building.kind, Number(button.dataset.queueIndex));
          });
          grid.append(button);
        }
        if (button.dataset.kind !== kind) {
          button.dataset.kind = kind;
          button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${unit.art}</svg><span class="queue-progress" aria-hidden="true"></span>`;
        }
        button.dataset.unitId = garrisoned ? String(id) : '';
        button.dataset.queueIndex = garrisoned ? '' : String(index);
        const label = garrisoned
          ? `${unit.name}, garrisoned. Click to eject from ${building.kind}.`
          : `${unit.name}, queue position ${index + 1}${index === 0 ? ', building' : ''}. Click to cancel and refund ${unit.cost} credits (up to credit cap).`;
        if (button.title !== label) {
          button.title = label;
          button.setAttribute('aria-label', label);
        }
        button.disabled = snapshot.demo || snapshot.outcome !== 'playing';
        button.classList.toggle('is-garrisoned', garrisoned);
        button.classList.toggle('is-building', index === 0);
        if (index === 0) button.style.setProperty('--progress', Math.min(1, snapshot[`${building.kind}_progress`]));
      });
      // Sit just above the roof and health bar; additional rows grow upward.
      this.anchor.set(building.x, 6.2, building.z).project(camera);
      grid.hidden = Math.abs(this.anchor.x) > 1 || Math.abs(this.anchor.y) > 1 || Math.abs(this.anchor.z) > 1;
      grid.style.left = `${(this.anchor.x + 1) * width / 2}px`;
      grid.style.top = `${(1 - this.anchor.y) * height / 2}px`;
    }
    for (const [id, grid] of this.grids) {
      if (!alive.has(id)) { grid.remove(); this.grids.delete(id); }
    }
  }
}
