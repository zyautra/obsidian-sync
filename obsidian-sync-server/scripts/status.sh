#!/bin/bash

# Obsidian Sync Server Status Script
# Shows current server status and information

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.obsidian-sync.pid"
LOG_FILE="$PROJECT_DIR/logs/application.log"
ERROR_LOG_FILE="$PROJECT_DIR/logs/error.log"

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

# Function to get human readable time
human_time() {
    local seconds=$1
    local days=$((seconds / 86400))
    local hours=$(((seconds % 86400) / 3600))
    local minutes=$(((seconds % 3600) / 60))
    local secs=$((seconds % 60))
    
    if [ $days -gt 0 ]; then
        printf "%dd %dh %dm %ds" $days $hours $minutes $secs
    elif [ $hours -gt 0 ]; then
        printf "%dh %dm %ds" $hours $minutes $secs
    elif [ $minutes -gt 0 ]; then
        printf "%dm %ds" $minutes $secs
    else
        printf "%ds" $secs
    fi
}

# Function to get file size
file_size() {
    if [ -f "$1" ]; then
        if command -v numfmt > /dev/null 2>&1; then
            stat -c%s "$1" | numfmt --to=iec-i --suffix=B
        else
            stat -c%s "$1" | awk '{
                if ($1 >= 1073741824) printf "%.1fGB", $1/1073741824
                else if ($1 >= 1048576) printf "%.1fMB", $1/1048576  
                else if ($1 >= 1024) printf "%.1fKB", $1/1024
                else printf "%dB", $1
            }'
        fi
    else
        echo "N/A"
    fi
}

echo -e "${BLUE}🔍 Obsidian Sync Server Status${NC}"
echo "================================="

# Check server status
if is_running; then
    PID=$(cat "$PID_FILE")
    echo -e "Status: ${GREEN}●${NC} ${GREEN}Running${NC}"
    echo -e "PID: ${GREEN}$PID${NC}"
    
    # Get process information
    if command -v ps > /dev/null 2>&1; then
        # Start time
        START_TIME=$(ps -o lstart= -p "$PID" 2>/dev/null | sed 's/^ *//')
        if [ -n "$START_TIME" ]; then
            echo -e "Started: ${GREEN}$START_TIME${NC}"
        fi
        
        # Runtime
        RUNTIME_SECONDS=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' ')
        if [ -n "$RUNTIME_SECONDS" ] && [ "$RUNTIME_SECONDS" -gt 0 ]; then
            RUNTIME=$(human_time "$RUNTIME_SECONDS")
            echo -e "Uptime: ${GREEN}$RUNTIME${NC}"
        fi
        
        # Memory usage
        MEMORY=$(ps -o rss= -p "$PID" 2>/dev/null | tr -d ' ')
        if [ -n "$MEMORY" ] && [ "$MEMORY" -gt 0 ]; then
            MEMORY_MB=$((MEMORY / 1024))
            echo -e "Memory: ${GREEN}${MEMORY_MB}MB${NC}"
        fi
        
        # CPU usage
        CPU=$(ps -o %cpu= -p "$PID" 2>/dev/null | tr -d ' ')
        if [ -n "$CPU" ]; then
            echo -e "CPU: ${GREEN}${CPU}%${NC}"
        fi
    fi
    
    # WebSocket port
    if command -v netstat > /dev/null 2>&1; then
        PORT_CHECK=$(netstat -tuln 2>/dev/null | grep ":3001 " | head -1)
        if [ -n "$PORT_CHECK" ]; then
            echo -e "WebSocket: ${GREEN}ws://localhost:3001${NC} (listening)"
        else
            echo -e "WebSocket: ${YELLOW}ws://localhost:3001${NC} (not detected)"
        fi
    else
        echo -e "WebSocket: ${GREEN}ws://localhost:3001${NC} (assumed)"
    fi
    
else
    echo -e "Status: ${RED}●${NC} ${RED}Stopped${NC}"
fi

echo ""

# Log files information
echo -e "${BLUE}📋 Log Files${NC}"
echo "============="

if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(file_size "$LOG_FILE")
    LOG_LINES=$(wc -l < "$LOG_FILE" 2>/dev/null || echo "0")
    LOG_MODIFIED=$(stat -c%Y "$LOG_FILE" 2>/dev/null)
    if [ -n "$LOG_MODIFIED" ]; then
        LOG_AGE=$(($(date +%s) - LOG_MODIFIED))
        if [ $LOG_AGE -lt 60 ]; then
            LOG_AGE_STR="${LOG_AGE}s ago"
        elif [ $LOG_AGE -lt 3600 ]; then
            LOG_AGE_STR="$((LOG_AGE / 60))m ago"
        else
            LOG_AGE_STR="$((LOG_AGE / 3600))h ago"
        fi
    else
        LOG_AGE_STR="unknown"
    fi
    echo -e "Main log: ${GREEN}logs/application.log${NC}"
    echo -e "  Size: $LOG_SIZE, Lines: $LOG_LINES, Modified: $LOG_AGE_STR"
else
    echo -e "Main log: ${YELLOW}logs/application.log${NC} (not found)"
fi

if [ -f "$ERROR_LOG_FILE" ]; then
    ERROR_SIZE=$(file_size "$ERROR_LOG_FILE")
    ERROR_LINES=$(wc -l < "$ERROR_LOG_FILE" 2>/dev/null || echo "0")
    echo -e "Error log: ${GREEN}logs/error.log${NC}"
    echo -e "  Size: $ERROR_SIZE, Lines: $ERROR_LINES"
    
    # Show recent errors if any
    if [ "$ERROR_LINES" -gt 0 ]; then
        echo -e "  ${YELLOW}⚠️  Contains $ERROR_LINES error entries${NC}"
    fi
else
    echo -e "Error log: ${GREEN}logs/error.log${NC} (clean)"
fi

echo ""

# Recent activity
if [ -f "$LOG_FILE" ]; then
    echo -e "${BLUE}📊 Recent Activity${NC}"
    echo "=================="
    
    # Get last 5 lines
    echo -e "${YELLOW}Last 5 log entries:${NC}"
    tail -n 5 "$LOG_FILE" 2>/dev/null | sed 's/^/  /' || echo "  No recent logs"
    
    echo ""
    
    # Count connections today
    TODAY=$(date +%Y-%m-%d)
    CONNECTIONS_TODAY=$(grep "$TODAY.*client_connected" "$LOG_FILE" 2>/dev/null | wc -l || echo "0")
    echo -e "Connections today: ${GREEN}$CONNECTIONS_TODAY${NC}"
    
    # Count recent errors
    RECENT_ERRORS=$(tail -n 100 "$LOG_FILE" 2>/dev/null | grep -i error | wc -l || echo "0")
    if [ "$RECENT_ERRORS" -gt 0 ]; then
        echo -e "Recent errors (last 100 lines): ${YELLOW}$RECENT_ERRORS${NC}"
    else
        echo -e "Recent errors: ${GREEN}None${NC}"
    fi
fi

echo ""

# Quick actions
echo -e "${BLUE}🛠️  Quick Actions${NC}"
echo "================="
if is_running; then
    echo -e "  ${YELLOW}./scripts/stop.sh${NC}     - Stop the server"
    echo -e "  ${YELLOW}tail -f logs/application.log${NC}"
    echo -e "                              - Monitor logs in real-time"
    echo -e "  ${YELLOW}./scripts/restart.sh${NC}  - Restart the server"
else
    echo -e "  ${YELLOW}./scripts/start.sh${NC}    - Start the server"
fi

echo -e "  ${YELLOW}./scripts/status.sh${NC}   - Show this status (refresh)"