#!/bin/bash

launchctl unload ~/Library/LaunchAgents/com.anc.serve.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.anc.web.plist 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.anc.serve.plist
rm -f ~/Library/LaunchAgents/com.anc.web.plist

echo "ANC services removed."
