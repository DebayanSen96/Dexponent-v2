#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${SCRIPT_DIR%/scripts}"
cd "$PROJECT_ROOT"

LOG_FILE="$PROJECT_ROOT/hardhat_node.log"
ADDR_FILE="$PROJECT_ROOT/deployment/hardhat_addresses.json"

if [ -f "$ADDR_FILE" ]; then
  rm -f "$ADDR_FILE"
fi

PORT_PID=$(lsof -t -i:8545 || true)
if [ -n "$PORT_PID" ]; then
  echo "Killing existing hardhat node process"
  kill -9 "$PORT_PID" || true
  sleep 2
fi

echo "Starting hardhat node"
nohup npx hardhat node > "$LOG_FILE" 2>&1 &
HARDHAT_NODE_PID=$!

sleep 10

echo "Deploying contracts"
npx hardhat run scripts/ProtocolDeployNew.ts --network localhost

echo "Running tests"
npx hardhat test --network localhost

echo "Killing hardhat node process"
kill "$HARDHAT_NODE_PID" || true
sleep 1
if kill -0 "$HARDHAT_NODE_PID" 2>/dev/null; then
  echo "Forcing kill of hardhat node process"
  kill -9 "$HARDHAT_NODE_PID" || true
fi
