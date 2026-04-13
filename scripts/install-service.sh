#!/bin/bash
set -e

cd /Users/zwang/projects/anc

echo "Building backend..."
npm run build

echo "Building web dashboard..."
cd apps/web && npm run build && cd ../..

echo "Installing launchd services..."
cp scripts/com.anc.serve.plist ~/Library/LaunchAgents/
cp scripts/com.anc.web.plist ~/Library/LaunchAgents/

# Unload first if already loaded (ignore errors)
launchctl unload ~/Library/LaunchAgents/com.anc.serve.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.anc.web.plist 2>/dev/null || true

launchctl load ~/Library/LaunchAgents/com.anc.serve.plist
launchctl load ~/Library/LaunchAgents/com.anc.web.plist

echo "ANC services installed. Backend :3849, Web :3000"
