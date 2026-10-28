#!/bin/sh
cd "$(dirname "$0")" || exit 1
python3 scripts/serve.py --port 8091
