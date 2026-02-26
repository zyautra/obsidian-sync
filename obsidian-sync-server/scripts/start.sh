#!/bin/bash

# Obsidian Sync Server Start Script
# Starts the server in background mode with proper logging

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.obsidian-sync.pid"

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

# Check if server is already running
if is_running; then
    echo -e "${YELLOW}⚠️  Obsidian Sync Server is already running (PID: $(cat $PID_FILE))${NC}"
    echo -e "   Use ${GREEN}./stop.sh${NC} to stop it first"
    exit 1
fi

# Change to project directory
cd "$PROJECT_DIR" || exit 1

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to install dependencies${NC}"
        exit 1
    fi
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Creating from .env.example...${NC}"
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}✅ Created .env file. Please configure it with your settings.${NC}"
    else
        echo -e "${RED}❌ No .env.example file found. Please create a .env file with:${NC}"
        echo "   DATABASE_URL=file:./sqlite.db"
        echo "   WS_PORT=3001"
        echo "   STORAGE_PATH=./obsidian"
        exit 1
    fi
fi

# Generate Prisma client if needed
if [ ! -d "node_modules/.prisma/client" ]; then
    echo -e "${YELLOW}🔧 Generating Prisma client...${NC}"
    npx prisma generate
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to generate Prisma client${NC}"
        exit 1
    fi
fi

# Build the application
echo -e "${YELLOW}🔨 Building application...${NC}"
npm run build > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed. Running in development mode...${NC}"
    MODE="development"
    START_CMD="npm run start:dev"
else
    echo -e "${GREEN}✅ Build successful${NC}"
    MODE="production"
    START_CMD="npm start"
fi

# Start the server
echo -e "${YELLOW}🚀 Starting Obsidian Sync Server in ${MODE} mode...${NC}"

# Start server in background and capture PID
if [ "$MODE" = "production" ]; then
    # Production mode
    nohup node dist/main.js > /dev/null 2>&1 &
    PID=$!
else
    # Development mode
    nohup npm run start:dev > /dev/null 2>&1 &
    PID=$!
fi

# Save PID to file
echo $PID > "$PID_FILE"

# Wait a moment for server to start
sleep 3

# Check if server started successfully
if ps -p $PID > /dev/null; then
    echo -e "${GREEN}✅ Obsidian Sync Server started successfully!${NC}"
    echo -e "   PID: ${GREEN}$PID${NC}"
    echo -e "   Mode: ${GREEN}$MODE${NC}"
    echo -e "   WebSocket: ${GREEN}ws://localhost:3001${NC}"
    echo -e "   Application logs: ${GREEN}logs/application.log${NC}"
    echo ""
    echo -e "   To monitor logs: ${YELLOW}tail -f logs/application.log${NC}"
    echo -e "   To stop server: ${YELLOW}./scripts/stop.sh${NC}"
    
    # Show last few lines of log
    echo ""
    echo -e "${YELLOW}📋 Recent logs:${NC}"
    tail -n 5 logs/application.log 2>/dev/null | sed 's/^/   /' || echo "   (No logs yet)"
else
    echo -e "${RED}❌ Failed to start Obsidian Sync Server${NC}"
    echo -e "   Check error logs: ${YELLOW}logs/error.log${NC}"
    rm -f "$PID_FILE"
    
    # Show error if exists
    if [ -f "logs/error.log" ] && [ -s "logs/error.log" ]; then
        echo ""
        echo -e "${RED}Error details:${NC}"
        tail -n 10 logs/error.log | sed 's/^/   /'
    fi
    exit 1
fi
