#!/bin/bash

echo "Backend:"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://localhost:3849/api/v1/tasks || echo "  DOWN"

echo "Web:"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://localhost:3000 || echo "  DOWN"

echo "tmux sessions:"
tmux list-sessions 2>/dev/null | wc -l | tr -d ' '
