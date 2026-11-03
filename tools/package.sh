#!/usr/bin/env bash
# Empaqueta el plugin en dist/AnalogFX_<version>.ccx (un .ccx es un zip de la carpeta plugin/)
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(python3 -c "import json;print(json.load(open('plugin/manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/AnalogFX_$V.ccx"
(cd plugin && zip -qr -X "../dist/AnalogFX_$V.ccx" . -x '.*')
ls -la "dist/AnalogFX_$V.ccx"
