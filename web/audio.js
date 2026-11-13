// Game audio, synthesized with the Web Audio API. Every sound is built when it
// plays, so there are no audio files to load. Nothing here reads or changes
// the match.
//
// Weapons and explosions are bursts of filtered noise, overdriven like a
// blast overloading a microphone, and ring out through an echo of open
// country. They carry no pitched sweeps, which are what make a synthesized
// shot sound like a toy. Orders are field drums, the result is a bugle call,
// the alarm is a siren, and the controls are switches and metal.
//
// Battlefield sounds are placed by the renderer (stereo pan; quieter, duller
// and more echoing when they happen outside the view) and fall silent while
// the match is paused. Interface sounds always play centered.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const between = (min, max) => min + Math.random() * (max - min);
const vary = (value, amount = .1) => value * between(1 - amount, 1 + amount);
const STORAGE_KEY = 'lower-base.muted';
// Battlefield sounds playing at once. Blasts are always heard.
const MAX_VOICES = 24;
// Engine level with the whole field on the move.
const RUMBLE = .06;
// Bugle notes.
const G3 = 196, C4 = 262, G4 = 392, C5 = 523, E5 = 659, G5 = 784;

// The sharp front of a shot or blast.
const crack = (audio, out, t, gain = 1, from = 1200) =>
  audio.noise(out, t, { gain, duration: .018, attack: .0005, type: 'highpass', from });
// The low end of a blast: a rumble and a thump in the chest.
const thump = (audio, out, t, gain, duration, pitch) => {
  audio.noise(out, t, { gain, duration, attack: .003, from: pitch * 4, brown: true });
  audio.tone(out, t, { gain: gain * .7, duration: duration * .6, attack: .002, from: pitch * 1.3, to: pitch });
};
// Loose pieces thrown up by a blast and landing after it.
const scatter = (audio, out, t, count, from, to, low, high, gain = .25, q = 1.2) => {
  for (let i = 0; i < count; i++) {
    const start = between(from, to);
    audio.noise(out, t + start, { gain: gain * between(.5, 1) * (1 - .6 * (start - from) / (to - from)),
      duration: between(.05, .2), attack: .002, type: 'bandpass', from: between(low, high), q });
  }
};
// One shot from a small arm: a crack, a bright body that darkens, and a thud.
const shot = (audio, out, t, bright, chest) => {
  crack(audio, out, t);
  audio.noise(out, t, { gain: .8, duration: vary(.13, .15), attack: .001, from: vary(bright, .2), to: 480 });
  audio.noise(out, t, { gain: .7, duration: .09, attack: .001, type: 'bandpass', from: vary(chest, .2), q: .8 });
  audio.noise(out, t, { gain: .6, duration: .08, attack: .002, from: chest * .4, brown: true });
};
// Drum strokes: [start, gain] for the snare, or [start, gain, pitch] for the bass drum.
const strokes = (audio, out, t, snare, bass = []) => {
  for (const [start, gain] of snare) audio.snare(out, t + start, gain);
  for (const [start, gain, pitch] of bass) audio.drum(out, t + start, gain, pitch);
};
// A switch thrown: two small parts landing one after the other.
const toggle = (audio, out, t, first, second) => {
  audio.noise(out, t, { gain: 1, duration: .01, attack: .0005, type: 'bandpass', from: first, q: 2 });
  audio.noise(out, t + .022, { gain: .7, duration: .02, attack: .0005, type: 'bandpass', from: second, q: 2 });
};
// A dull knock on something heavy.
const knock = (audio, out, t, gain = 1) => {
  audio.noise(out, t, { gain, duration: .07, attack: .002, from: 300, brown: true });
  audio.noise(out, t, { gain: gain * .25, duration: .012, attack: .0005, type: 'bandpass', from: 1400, q: 1.5 });
};

// Each sound has a level, a minimum gap between two of its kind, and the
// length of its tail. A sound arriving inside the gap is held back by up to
// `hold` seconds (one gap unless given), so a volley is heard as ripple fire;
// beyond that it is dropped. `wet` is how much of it goes to the echo, and
// `drive` how hard it is overdriven.
const SOUNDS = {
  // ---- Weapons ----
  rifle: { level: .85, wet: .5, gap: .05, hold: .12, length: .2, make(audio, out, t) {
    shot(audio, out, t, 3400, 650);
  } },
  // The command center's own gun: heavier, and fired two rounds at a time.
  command: { level: .5, wet: .5, gap: .16, hold: .2, length: .3, make(audio, out, t) {
    shot(audio, out, t, 2300, 420);
    shot(audio, out, t + vary(.085), 2300, 420);
  } },
  // Ignition, backblast, and a motor that fades as the rocket leaves.
  rocket: { level: .5, wet: .5, gap: .07, hold: .25, length: .8, make(audio, out, t) {
    crack(audio, out, t, .9, 900);
    audio.noise(out, t, { gain: .7, duration: .16, attack: .001, from: 1400, to: 300 });
    audio.noise(out, t + .02, { gain: .6, duration: .7, attack: .05, type: 'bandpass', from: vary(2200, .15), to: 500, q: .9 });
    audio.noise(out, t + .02, { gain: .22, duration: .5, attack: .04, type: 'highpass', from: 3500 });
  } },
  cannon: { level: .2, wet: .7, drive: 2.5, gap: .07, hold: .3, length: .6, make(audio, out, t) {
    crack(audio, out, t, 1, 800);
    audio.noise(out, t, { gain: 1, duration: .45, attack: .001, from: vary(2600), to: 160 });
    thump(audio, out, t, .9, .5, 44);
  } },
  // Anti-tank gun: a longer report, and the breech ringing after it.
  gun: { level: .23, wet: .75, drive: 3, gap: .1, hold: .3, length: .8, make(audio, out, t) {
    crack(audio, out, t, 1, 700);
    audio.noise(out, t, { gain: 1, duration: .6, attack: .001, from: vary(2200), to: 130 });
    thump(audio, out, t, 1, .7, 38);
    audio.metal(out, t + .04, { gain: .05, duration: .5, base: vary(330, .05) });
  } },

  // ---- Hits and destruction ----
  // A shell or rocket bursting, and the dirt it throws up.
  impact: { level: .2, wet: .65, drive: 2, gap: .06, hold: .2, length: .6, make(audio, out, t) {
    crack(audio, out, t, .9, 1000);
    audio.noise(out, t, { gain: 1, duration: vary(.4, .2), attack: .001, from: vary(2400, .25), to: 150 });
    thump(audio, out, t, .8, .45, 48);
    scatter(audio, out, t, 5, .08, .45, 1500, 4000, .15);
  } },
  // A soldier going down: the body, then his kit.
  fall: { level: 1.2, wet: .2, gap: .06, hold: .2, length: .25, make(audio, out, t) {
    audio.noise(out, t, { gain: 1, duration: .12, attack: .004, from: 320, brown: true });
    for (let i = 0; i < 3; i++) {
      audio.noise(out, t + between(.02, .15), { gain: .2, duration: .03, attack: .001, type: 'bandpass',
        from: between(2200, 4200), q: 6 });
    }
  } },
  // A vehicle blowing up: the hull rings and shrapnel sings off it.
  wreck: { level: .25, wet: .7, drive: 2.5, gap: .08, hold: .3, length: 1.3, priority: true, make(audio, out, t) {
    crack(audio, out, t, 1, 900);
    audio.noise(out, t, { gain: 1, duration: .9, attack: .001, from: vary(2800), to: 120 });
    thump(audio, out, t, 1, 1.1, 40);
    audio.metal(out, t + .03, { gain: .12, duration: .9, base: vary(240, .2) });
    scatter(audio, out, t, 5, .06, .6, 1600, 3800, .1, 10);
  } },
  // A building coming down: the blast, then the masonry.
  collapse: { level: .29, wet: .7, drive: 2.5, gap: .12, hold: .4, length: 2.6, priority: true, make(audio, out, t) {
    crack(audio, out, t, .8, 900);
    audio.noise(out, t, { gain: 1, duration: 2, attack: .001, from: vary(1900), to: 80 });
    thump(audio, out, t, 1, 2.2, 34);
    scatter(audio, out, t, 16, .1, 2, 300, 1300, .45, .8);
    scatter(audio, out, t, 8, .15, 1.6, 800, 1900, .2, 3);
  } },
  // A demolition truck: the blast, its echo coming back off the far side of
  // the field, and debris raining down.
  demolition: { level: .7, wet: .9, drive: 3.5, gap: .15, hold: .5, length: 3.6, priority: true, make(audio, out, t) {
    crack(audio, out, t, 1.2, 700);
    audio.noise(out, t, { gain: 1.1, duration: 2.8, attack: .001, from: 4000, to: 60 });
    thump(audio, out, t, 1.3, 3.4, 30);
    audio.noise(out, t + .42, { gain: .45, duration: 1.6, attack: .03, from: 700, to: 100 });
    scatter(audio, out, t, 16, .3, 2.4, 400, 1800, .3, .8);
  } },
  // Ore rattling out of a collector's hopper.
  pour: { level: .25, wet: .15, gap: .2, hold: 0, length: 1.1, make(audio, out, t) {
    audio.noise(out, t, { gain: .3, duration: 1, attack: .15, type: 'bandpass', from: 1500, to: 1000, q: .8 });
    scatter(audio, out, t, 24, .05, .9, 900, 2600, .5, 3);
  } },

  // ---- Interface ----
  click: { ui: true, level: 1.1, gap: .03, length: .05, make(audio, out, t) { toggle(audio, out, t, 2600, 1100); } },
  // A handset keyed: a click and a breath of static.
  select: { ui: true, level: 1, gap: .03, length: .1, make(audio, out, t) {
    audio.noise(out, t, { gain: 1, duration: .012, attack: .0005, type: 'bandpass', from: 1700, q: 1.5 });
    audio.noise(out, t + .01, { gain: .22, duration: .07, attack: .01, type: 'bandpass', from: 2100, q: .8 });
  } },
  // Orders are beaten on the drum: two taps to gather, a roll into an accent
  // to attack, two slow beats of the bass drum to fall back.
  gather: { ui: true, level: .2, wet: .35, gap: .1, length: .4, make(audio, out, t) {
    strokes(audio, out, t, [[0, .7], [.14, .9]]);
  } },
  attack: { ui: true, level: .1, wet: .35, gap: .1, length: .6, make(audio, out, t) {
    strokes(audio, out, t, [[0, .35], [.07, .45], [.13, .55], [.18, .65], [.22, .75], [.3, 1.1]], [[.3, 1, 75]]);
  } },
  retreat: { ui: true, level: .1, wet: .35, gap: .1, length: .7, make(audio, out, t) {
    strokes(audio, out, t, [], [[0, 1, 105], [.24, 1.1, 80]]);
  } },
  send: { ui: true, level: .2, wet: .35, gap: .1, length: .4, make(audio, out, t) {
    strokes(audio, out, t, [[0, 1]], [[0, .9, 80]]);
  } },
  // A unit ordered: a bolt drawn back and pushed home.
  queue: { ui: true, level: .4, wet: .1, gap: .04, length: .15, make(audio, out, t) {
    for (const [start, pitch] of [[0, 3200], [.075, 2300]]) {
      audio.noise(out, t + start, { gain: 1, duration: .022, attack: .0005, type: 'bandpass', from: vary(pitch, .05), q: 5 });
      audio.noise(out, t + start, { gain: .5, duration: .04, attack: .001, from: 320, brown: true });
    }
  } },
  cancel: { ui: true, level: .75, gap: .04, length: .1, make(audio, out, t) { knock(audio, out, t); } },
  // An order that cannot be carried out.
  denied: { ui: true, level: .4, gap: .15, length: .25, make(audio, out, t) {
    knock(audio, out, t); knock(audio, out, t + .1, .8);
  } },
  // Construction starting: a hammer on steel.
  build: { ui: true, level: .13, wet: .3, gap: .1, length: .7, make(audio, out, t) {
    for (const [start, gain] of [[0, .8], [.17, 1], [.34, .9]]) {
      audio.metal(out, t + start, { gain, duration: .22, base: vary(540, .03) });
      audio.noise(out, t + start, { gain: gain * .5, duration: .04, attack: .001, from: 300, brown: true });
    }
  } },
  // A unit reporting: a three-stroke ruff.
  ready: { ui: true, level: .2, wet: .3, gap: .25, length: .4, make(audio, out, t) {
    strokes(audio, out, t, [[0, .35], [.05, .45], [.11, 1]]);
  } },
  // Construction finished: one blow that rings.
  complete: { ui: true, level: .17, wet: .4, gap: .25, length: 1.2, make(audio, out, t) {
    audio.metal(out, t, { gain: 1, duration: 1.1, base: 620 });
    audio.noise(out, t, { gain: .5, duration: .05, attack: .001, from: 320, brown: true });
  } },
  // An ore delivery credited: a clink.
  credit: { ui: true, level: .09, wet: .1, gap: .1, length: .15, make(audio, out, t) {
    audio.metal(out, t, { gain: 1, duration: .13, base: 2100 });
  } },
  // Base under attack: an air-raid siren winding up and down.
  alert: { ui: true, level: .08, wet: .4, gap: 3, hold: 0, length: 2.4, make(audio, out, t) { audio.siren(out, t, 2.3); } },
  pause: { ui: true, level: 1.2, gap: .05, length: .08, make(audio, out, t) { toggle(audio, out, t, 2000, 700); } },
  resume: { ui: true, level: 1.2, gap: .05, length: .08, make(audio, out, t) { toggle(audio, out, t, 800, 2400); } },
  // Match start: two beats of the bass drum and a roll into a final stroke.
  start: { ui: true, level: .12, wet: .4, gap: .3, length: 1.6, make(audio, out, t) {
    strokes(audio, out, t,
      [[.6, .3], [.68, .35], [.75, .4], [.81, .5], [.87, .6], [.92, .7], [.97, .8], [1.06, 1.1]],
      [[0, 1, 75], [.3, 1, 75], [1.06, 1.1, 75]]);
  } },
  // A bugle sounding the charge over a drum roll.
  victory: { ui: true, level: .14, wet: .45, gap: 1, length: 2.4, make(audio, out, t) {
    for (let i = 0; i < 7; i++) audio.snare(out, t + i * .06, .25 + i * .05);
    strokes(audio, out, t, [[.42, 1], [.94, 1]], [[.42, 1, 75], [.94, 1.1, 75]]);
    for (const [start, pitch, duration] of [[0, G4, .11], [.14, C5, .11], [.28, E5, .11], [.42, G5, .32], [.8, E5, .11], [.94, G5, 1]]) {
      audio.brass(out, t + start, pitch, duration);
    }
  } },
  // The first notes of a last post, low and slow, over a muffled drum.
  defeat: { ui: true, level: .14, wet: .5, gap: 1, length: 3, make(audio, out, t) {
    strokes(audio, out, t, [], [[0, 1, 68], [.75, 1, 68]]);
    for (const [start, pitch, duration] of [[0, G3, .5], [.55, G3, .15], [.75, C4, 1.7]]) {
      audio.brass(out, t + start, pitch, duration);
    }
  } },
};

export class GameAudio {
  // Pass a context to render into it (an OfflineAudioContext, in tests).
  // Otherwise the browser's context is created by the first `unlock()`.
  constructor({ context = null } = {}) {
    this.ctx = null;
    this.live = !context;
    this.muted = false;
    this.active = false;
    this.last = new Map();
    this.voices = [];
    if (context) this.build(context);
    if (!this.live) return;
    try { this.muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage unavailable */ }
    // A hidden tab stops the match, so its sound stops with it.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }
  // Browsers only start audio from a user gesture; call this from one.
  unlock() {
    if (!this.live) return;
    if (!this.ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      try { this.build(new Context({ latencyHint: 'interactive' })); } catch { return; }
    }
    if (this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {});
  }
  build(ctx) {
    this.ctx = ctx;
    const rate = ctx.sampleRate;
    // near/far and the echo → world → master; interface → master;
    // master → limiter → output.
    // The limiter boosts quiet passages, so the output is trimmed for headroom.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14; limiter.knee.value = 10; limiter.ratio.value = 12;
    limiter.attack.value = .003; limiter.release.value = .25;
    const trim = ctx.createGain(); trim.gain.value = .8;
    limiter.connect(trim).connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(limiter);
    this.world = ctx.createGain(); this.world.gain.value = this.active ? 1 : 0;
    this.world.connect(this.master);
    this.near = ctx.createGain(); this.near.connect(this.world);
    // Fighting outside the view is quieter and loses its high end.
    this.far = ctx.createBiquadFilter(); this.far.type = 'lowpass'; this.far.frequency.value = 900;
    const distance = ctx.createGain(); distance.gain.value = .55;
    this.far.connect(distance).connect(this.world);
    this.ui = ctx.createGain(); this.ui.connect(this.master);

    // The echo of open country: reflections off buildings and treelines,
    // then a tail that rolls away and darkens like distant thunder.
    const tail = Math.floor(rate * 2.4);
    const echo = ctx.createBuffer(2, tail, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = echo.getChannelData(channel);
      const reflections = [[.09, .5], [.19, .4], [.33, .3], [.52, .18]].map(([at, amount]) => [vary(at, .15), amount]);
      let low = 0;
      for (let i = Math.floor(rate * .012); i < tail; i++) {
        const time = i / rate;
        let value = (Math.random() * 2 - 1) * Math.exp(-time / .42);
        for (const [at, amount] of reflections) {
          if (time >= at && time < at + .03) value += (Math.random() * 2 - 1) * amount * Math.exp(-(time - at) / .008);
        }
        low += (.5 * Math.exp(-time / .5) + .04) * (value - low);
        data[i] = low;
      }
    }
    const reverb = ctx.createConvolver(); reverb.buffer = echo;
    this.send = ctx.createGain(); this.send.gain.value = .5;
    this.send.connect(reverb).connect(this.world);
    // Overdrive, shared by every blast.
    this.curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) this.curve[i] = Math.tanh(3 * (i / 511.5 - 1));

    const length = Math.floor(rate * 2);
    this.whiteNoise = ctx.createBuffer(1, length, rate);
    this.brownNoise = ctx.createBuffer(1, length, rate);
    const white = this.whiteNoise.getChannelData(0), brown = this.brownNoise.getChannelData(0);
    let level = 0;
    for (let i = 0; i < length; i++) {
      white[i] = Math.random() * 2 - 1;
      level = (level + .02 * white[i]) / 1.02;
      brown[i] = level * 3.5;
    }
    // Take out the drift, so the loop closes without a click.
    for (let i = 0; i < length; i++) brown[i] -= brown[length - 1] * i / (length - 1);
    this.loops = null;
    if (this.active) this.startLoops();
  }
  // The wind over the field and the engines of whatever is driving on it.
  startLoops() {
    const ctx = this.ctx;
    const loop = buffer => {
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true; source.start();
      return source;
    };
    const lfo = (frequency, depth, target, type = 'sine') => {
      const oscillator = ctx.createOscillator(); oscillator.type = type; oscillator.frequency.value = frequency;
      const amount = ctx.createGain(); amount.gain.value = depth;
      oscillator.connect(amount).connect(target); oscillator.start();
      return oscillator;
    };
    const filter = (type, frequency, q = .7) => {
      const node = ctx.createBiquadFilter(); node.type = type; node.frequency.value = frequency; node.Q.value = q;
      return node;
    };
    const level = value => { const node = ctx.createGain(); node.gain.value = value; return node; };
    const wind = filter('bandpass', 380, 1.2), windLevel = level(.06);
    lfo(.11, 150, wind.frequency); lfo(.07, .02, windLevel.gain);
    loop(this.whiteNoise).connect(wind).connect(filter('lowpass', 1000)).connect(windLevel).connect(this.world);

    this.rumble = level(0); this.rumble.connect(this.world);
    // Diesels: a slow, uneven firing pulse under a bed of low noise.
    const exhaust = filter('lowpass', 190), chug = level(.6);
    lfo(13, .4, chug.gain);
    loop(this.brownNoise).connect(filter('lowpass', 170)).connect(chug).connect(this.rumble);
    for (const frequency of [27.5, 41.2]) lfo(frequency, .35, exhaust, 'sawtooth').detune.value = between(-20, 20);
    exhaust.connect(this.rumble);
    // Tracks: links clattering over the sprockets.
    const clatter = level(0);
    lfo(9, .035, clatter.gain, 'square');
    loop(this.whiteNoise).connect(filter('bandpass', 2300, 2)).connect(clatter).connect(this.rumble);
    this.loops = true;
  }
  ramp(param, value, seconds = .05) {
    const now = this.ctx.currentTime, current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.setTargetAtTime(value, now, seconds);
  }
  setMuted(muted) {
    this.muted = !!muted;
    try { localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0'); } catch { /* storage unavailable */ }
    if (this.ctx) this.ramp(this.master.gain, this.muted ? 0 : 1, .02);
  }
  // The battlefield is heard only while a match is running and not paused.
  setWorld(active) {
    this.active = !!active;
    if (!this.ctx) return;
    if (this.active && !this.loops) this.startLoops();
    this.ramp(this.world.gain, this.active ? 1 : 0);
  }
  // How much armor is on the move, from 0 to 1.
  setRumble(level) {
    if (this.loops) this.ramp(this.rumble.gain, clamp(level, 0, 1) * RUMBLE, .3);
  }
  // `pan` runs from -1 (left) to 1 (right). `far` marks a sound outside the view.
  play(name, options = {}) {
    const ctx = this.ctx, sound = SOUNDS[name];
    if (!ctx || !sound || this.muted || (!sound.ui && !this.active)) return;
    if (this.live && ctx.state !== 'running') {
      // The click that starts the audio gets its own sound once it is running.
      if (sound.ui && !options.retried && !document.hidden) {
        ctx.resume().then(() => this.play(name, { ...options, retried: true }), () => {});
      }
      return;
    }
    const now = ctx.currentTime;
    const at = Math.max(now, (this.last.get(name) ?? -Infinity) + sound.gap);
    if (at - now > (sound.hold ?? sound.gap)) return;
    this.voices = this.voices.filter(end => end > now);
    if (!sound.ui && !sound.priority && this.voices.length >= MAX_VOICES) return;
    this.last.set(name, at);
    // The recipe plays into `input`; `out` carries it on at the sound's level.
    const out = ctx.createGain();
    out.gain.value = sound.level * (options.size ?? 1);
    let input = out;
    if (sound.drive) {
      input = ctx.createGain(); input.gain.value = sound.drive;
      const shaper = ctx.createWaveShaper(); shaper.curve = this.curve; shaper.oversample = '2x';
      input.connect(shaper).connect(out);
    }
    if (sound.ui) out.connect(this.ui);
    else {
      this.voices.push(at + sound.length);
      const bus = options.far ? this.far : this.near;
      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = clamp(options.pan ?? 0, -1, 1);
        out.connect(panner).connect(bus);
      } else out.connect(bus);
    }
    if (sound.wet) {
      // Distance leaves more of the echo than of the sound itself.
      const wet = ctx.createGain(); wet.gain.value = sound.wet * (options.far ? 1.5 : 1);
      out.connect(wet).connect(this.send);
    }
    sound.make(this, input, at + .005);
  }

  // A percussive envelope: a fast attack, then a decay to silence.
  envelope(out, t, gain, duration, attack = .004) {
    const node = this.ctx.createGain();
    node.gain.setValueAtTime(0, t);
    node.gain.linearRampToValueAtTime(gain, t + attack);
    node.gain.exponentialRampToValueAtTime(.001, t + Math.max(duration, attack + .01));
    node.connect(out);
    return node;
  }
  // Noise through a filter that sweeps from one frequency to another.
  noise(out, t, { gain, duration, attack, type = 'lowpass', from, to = from, q = .7, brown = false }) {
    const source = this.ctx.createBufferSource();
    source.buffer = brown ? this.brownNoise : this.whiteNoise; source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    source.connect(filter).connect(this.envelope(out, t, gain, duration, attack));
    source.start(t, Math.random() * (source.buffer.duration - .1)); source.stop(t + duration + .02);
  }
  // An oscillator, gliding from one pitch to another over `glide` seconds.
  tone(out, t, { gain, duration, attack, type = 'sine', from, to = from, glide = duration }) {
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, t);
    if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, t + glide);
    oscillator.connect(this.envelope(out, t, gain, duration, attack));
    oscillator.start(t); oscillator.stop(t + duration + .02);
  }
  // Struck metal: partials that are not in tune with each other, the high
  // ones dying first.
  metal(out, t, { gain, duration, base }) {
    [1, 1.51, 2.27, 2.92, 3.83, 5.12].forEach((ratio, i) => this.tone(out, t, { gain: gain / (i + 1.5),
      duration: duration / (1 + i * .45), attack: .001, from: base * ratio * vary(1, .01) }));
    this.noise(out, t, { gain: gain * .8, duration: .012, attack: .0005, type: 'highpass', from: 2500 });
  }
  // A field drum: the rattle of the snares over the ring of the head.
  snare(out, t, gain = 1, pitch = 185) {
    this.noise(out, t, { gain, duration: .16, attack: .001, type: 'highpass', from: 1700 });
    this.noise(out, t, { gain: gain * .6, duration: .09, attack: .001, type: 'bandpass', from: 900, q: 1 });
    this.tone(out, t, { gain: gain * .5, duration: .07, attack: .001, from: pitch });
    this.tone(out, t, { gain: gain * .3, duration: .05, attack: .001, from: pitch * 1.78 });
  }
  // A bass drum: the beater, then the head settling to its pitch. The upper
  // partial is what small speakers reproduce.
  drum(out, t, gain = 1, pitch = 75) {
    this.tone(out, t, { gain, duration: .34, attack: .002, from: pitch * 1.5, to: pitch, glide: .03 });
    this.tone(out, t, { gain: gain * .45, duration: .16, attack: .002, from: pitch * 2.6, to: pitch * 2.2, glide: .03 });
    this.noise(out, t, { gain: gain * .6, duration: .04, attack: .001, from: 1100 });
  }
  // A bugle note: two reeds a hair apart, opening up as the note is blown
  // and wavering slightly while it is held.
  brass(out, t, frequency, duration, gain = 1) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(frequency * 1.2, t);
    filter.frequency.linearRampToValueAtTime(frequency * 4.5, t + .05);
    filter.frequency.setTargetAtTime(frequency * 3, t + .05, .12);
    const blown = ctx.createGain();
    blown.gain.setValueAtTime(0, t);
    blown.gain.linearRampToValueAtTime(gain * .5, t + .03);
    blown.gain.setTargetAtTime(gain * .38, t + .03, .08);
    blown.gain.setTargetAtTime(0, t + duration, .035);
    const waver = ctx.createOscillator(); waver.frequency.value = 5.2;
    const depth = ctx.createGain(); depth.gain.value = frequency * .004;
    waver.connect(depth); waver.start(t); waver.stop(t + duration + .3);
    for (const detune of [-5, 5]) {
      const reed = ctx.createOscillator(); reed.type = 'sawtooth';
      reed.frequency.value = frequency; reed.detune.value = detune;
      depth.connect(reed.frequency);
      reed.connect(filter); reed.start(t); reed.stop(t + duration + .3);
    }
    filter.connect(blown).connect(out);
  }
  // A hand-cranked siren: two tones a minor third apart, winding up and
  // running down, beating as the rotor turns.
  siren(out, t, duration) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1500;
    const wail = ctx.createGain();
    wail.gain.setValueAtTime(0, t);
    wail.gain.linearRampToValueAtTime(.5, t + .15);
    wail.gain.setTargetAtTime(0, t + duration - .5, .15);
    const rotor = ctx.createOscillator(); rotor.frequency.value = 7;
    const beat = ctx.createGain(); beat.gain.value = .12;
    rotor.connect(beat).connect(wail.gain); rotor.start(t); rotor.stop(t + duration + .2);
    for (const ratio of [1, 1.2]) {
      const tone = ctx.createOscillator(); tone.type = 'sawtooth';
      tone.frequency.setValueAtTime(280 * ratio, t);
      tone.frequency.linearRampToValueAtTime(520 * ratio, t + duration * .4);
      tone.frequency.linearRampToValueAtTime(330 * ratio, t + duration);
      tone.connect(filter); tone.start(t); tone.stop(t + duration + .2);
    }
    filter.connect(wail).connect(out);
  }
}
