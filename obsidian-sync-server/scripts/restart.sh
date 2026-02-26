#!/bin/bash

# Obsidian Sync Server Restart Script
# Gracefully stops and starts the server

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}🔄 Restarting Obsidian Sync Server${NC}"
echo "=================================="

# Stop the server first
echo -e "${YELLOW}Step 1: Stopping server...${NC}"
"$SCRIPT_DIR/stop.sh"

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to stop server${NC}"
    exit 1
fi

echo ""

# Wait a moment
echo -e "${YELLOW}⏳ Waiting 2 seconds...${NC}"
sleep 2

# Start the server
echo -e "${YELLOW}Step 2: Starting server...${NC}"
"$SCRIPT_DIR/start.sh"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Server restarted successfully!${NC}"
else
    echo -e "${RED}❌ Failed to start server${NC}"
    exit 1
fi