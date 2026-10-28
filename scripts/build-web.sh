#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

mode=${1:---dev}
if [ "$#" -gt 1 ]; then
  echo 'Usage: ./scripts/build-web.sh [--dev|--production]' >&2
  exit 2
fi
case "$mode" in
  --dev|--production) ;;
  *) echo 'Usage: ./scripts/build-web.sh [--dev|--production]' >&2; exit 2 ;;
esac

if ! rustup target list --installed | grep -qx wasm32-unknown-unknown; then
  echo 'Install the WebAssembly target: rustup target add wasm32-unknown-unknown' >&2
  exit 1
fi
if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo 'Install wasm-bindgen: cargo install wasm-bindgen-cli --version 0.2.129 --locked' >&2
  exit 1
fi
if [ "$mode" = '--dev' ]; then
  cargo build --release --target wasm32-unknown-unknown --features dev-debug
else
  cargo build --release --target wasm32-unknown-unknown --no-default-features
fi
wasm-bindgen target/wasm32-unknown-unknown/release/lower_base.wasm --out-dir web/pkg --target web
python3 - "$mode" <<'PY'
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sources = [Path('Cargo.toml'), Path('Cargo.lock')]
sources += list(Path('src').rglob('*.rs'))
sources += [p for p in Path('web').rglob('*') if p.is_file()
            and 'pkg' not in p.parts and p.suffix in {'.js', '.mjs', '.html', '.css'}]
digest = hashlib.sha256()
for path in sorted(sources):
    digest.update(str(path).encode() + b'\0' + path.read_bytes() + b'\0')
revision = subprocess.check_output(
    ['git', 'describe', '--always', '--dirty', '--exclude', '*'], text=True).strip()
config = dict(development=sys.argv[1] == '--dev', revision=revision,
              source_sha256=digest.hexdigest(),
              built_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
Path('web/pkg/build_config.js').write_text('export const BUILD_INFO = '
                                        + json.dumps(config) + ';\n')
PY
