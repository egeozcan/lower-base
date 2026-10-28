// Local build instrumentation. Commands are applied before updates[tick] when
// replaying; checkpoints contain the same simulation state plus AI internals.
export class MatchDebugRecorder {
  constructor(metadata, initialState) {
    this.metadata = structuredClone(metadata);
    this.updates = [];
    this.commands = [];
    this.checkpoints = [{ tick: 0, snapshot: initialState }];
    this.nextCheckpoint = 2;
    this.report = null;
  }

  command(action, args, time) {
    if (!this.report) this.commands.push({ tick: this.updates.length, time, action, args: structuredClone(args) });
  }

  updated(dt) {
    if (!this.report) this.updates.push(dt);
  }

  observe(state, readDebugState) {
    if (!this.report && state.time >= this.nextCheckpoint) {
      this.checkpoints.push({ tick: this.updates.length, snapshot: readDebugState() });
      this.nextCheckpoint = state.time + 2;
    }
  }

  finish(finalState) {
    if (!this.report) {
      this.checkpoints.push({ tick: this.updates.length, snapshot: finalState });
      this.report = {
        schema_version: 1,
        game: 'lower-base',
        metadata: this.metadata,
        finished_at: new Date().toISOString(),
        updates: this.updates,
        commands: this.commands,
        checkpoints: this.checkpoints,
        final_state: finalState,
      };
    }
    return this.report;
  }
}

export function createDebugActions(card, readReport) {
  const actions = document.createElement('div');
  actions.id = 'debug-actions';
  actions.hidden = true;
  const download = document.createElement('button');
  download.type = 'button';
  download.id = 'download-debug';
  download.textContent = 'DOWNLOAD DEBUG DATA';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.id = 'copy-debug';
  copy.textContent = 'COPY DEBUG DATA';
  const status = document.createElement('p');
  status.id = 'debug-status';
  status.setAttribute('role', 'status');
  const fallback = document.createElement('textarea');
  fallback.id = 'debug-copy-fallback';
  fallback.readOnly = true;
  fallback.hidden = true;
  fallback.setAttribute('aria-label', 'Debug data ready to copy');
  fallback.rows = 5;
  actions.append(download, copy, status, fallback);
  card.append(actions);

  download.addEventListener('click', () => {
    const report = readReport();
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = report.filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Debug download started.';
  });
  copy.addEventListener('click', async () => {
    const report = readReport();
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.text);
      if (readReport() !== report) return;
      fallback.hidden = true;
      status.textContent = 'Debug data copied.';
    } catch {
      if (readReport() !== report) return;
      // Non-secure LAN origins and denied clipboard permission still allow
      // manual copying, without another permission flow or losing the report.
      fallback.value = report.text;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
      status.textContent = 'Copy the selected debug data, or use Download Debug Data.';
    }
  });
  return {
    show() { actions.hidden = false; },
    reset() { actions.hidden = true; status.textContent = ''; fallback.hidden = true; fallback.value = ''; },
  };
}
