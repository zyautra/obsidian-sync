#!/bin/bash

# Obsidian Sync Server Stop Script
# Gracefully stops the background server

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.obsidian-sync.pid"
LOG_FILE="$PROJECT_DIR/logs/application.log"

# Function to check if server is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        else
            # PID file exists but process is not running
            rm -f "$PID_FILE"
            return 1
        fi
    fi
    return 1
}

# Check if server is running
if ! is_running; then
    echo -e "${YELLOW}⚠️  Obsidian Sync Server is not running${NC}"
    
    # Clean up stale PID file if it exists
    if [ -f "$PID_FILE" ]; then
        rm -f "$PID_FILE"
        echo -e "${GREEN}✅ Cleaned up stale PID file${NC}"
    fi
    exit 0
fi

# Get PID
PID=$(cat "$PID_FILE")
echo -e "${YELLOW}🛑 Stopping Obsidian Sync Server (PID: $PID)...${NC}"

# Try graceful shutdown first (SIGTERM)
kill -TERM "$PID" 2>/dev/null

# Wait for graceful shutdown (up to 10 seconds)
TIMEOUT=10
while [ $TIMEOUT -gt 0 ]; do
    if ! ps -p "$PID" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Server stopped gracefully${NC}"
        rm -f "$PID_FILE"
        
        # Show final log lines
        if [ -f "$LOG_FILE" ]; then
            echo ""
            echo -e "${YELLOW}📋 Final logs:${NC}"
            tail -n 3 "$LOG_FILE" 2>/dev/null | sed 's/^/   /'
        fi
        
        exit 0
    fi
    sleep 1
    TIMEOUT=$((TIMEOUT - 1))
    echo -ne "${YELLOW}   Waiting for graceful shutdown... ${TIMEOUT}s\r${NC}"
done

echo ""
echo -e "${YELLOW}⚠️  Graceful shutdown timed out. Force killing...${NC}"

# Force kill if graceful shutdown failed
kill -KILL "$PID" 2>/dev/null

# Wait a moment
sleep 2

# Check if process is really dead
if ps -p "$PID" > /dev/null 2>&1; then
    echo -e "${RED}❌ Failed to stop server process (PID: $PID)${NC}"
    echo -e "   Try manually: ${YELLOW}kill -9 $PID${NC}"
    exit 1
else
    echo -e "${GREEN}✅ Server force stopped${NC}"
    rm -f "$PID_FILE"
    
    # Show final log lines
    if [ -f "$LOG_FILE" ]; then
        echo ""
        echo -e "${YELLOW}📋 Final logs:${NC}"
        tail -n 3 "$LOG_FILE" 2>/dev/null | sed 's/^/   /'
    fi
fi

# Also kill any remaining npm processes that might be related
echo -e "${YELLOW}🧹 Cleaning up any remaining processes...${NC}"
pkill -f "npm.*start" 2>/dev/null || true
pkill -f "nest start" 2>/dev/null || true

echo -e "${GREEN}✅ Cleanup complete${NC}"
