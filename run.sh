#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "============================================"
echo "  MHC Causelist - Fetching tomorrow's cases"
echo "============================================"
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies, please wait..."
    npm install
fi
node --use-system-ca mhc_cases.js
echo ""
echo "Done. The PDF is in the pdfs folder."
