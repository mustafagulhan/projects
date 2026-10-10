#!/usr/bin/env bash
# Regenerates index.html (standalone, openable via file://) from the artifact fragment sayfa.html.
set -euo pipefail
cd "$(dirname "$0")/.."
{ printf '<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%%}</style>\n</head>\n<body>\n'; cat sayfa.html; printf '\n</body>\n</html>\n'; } > index.html
echo "index.html rebuilt"
