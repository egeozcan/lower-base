#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if ! rustup target list --installed | grep -qx wasm32-unknown-unknown; then
  echo 'Install the WebAssembly target: rustup target add wasm32-unknown-unknown' >&2
  exit 1
fi
if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo 'Install wasm-bindgen: cargo install wasm-bindgen-cli --version 0.2.129 --locked' >&2
  exit 1
fi
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/release/lower_base.wasm --out-dir web/pkg --target web
