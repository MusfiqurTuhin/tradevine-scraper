#!/bin/bash

# --- Tradevine Scraper: One-Command Start ---
# This script handles setup and launches the dashboard automatically.

echo "----------------------------------------"
echo "🚀 Tradevine Scraper: Starting Setup..."
echo "----------------------------------------"

# 1. Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "❌ ERROR: Node.js is not installed."
    echo "Please download it from: https://nodejs.org/"
    exit
fi

# 2. Skip installation if node_modules exists
if [ -d "node_modules" ]; then
    echo "✅ Dependencies already installed. Skipping npm install..."
else
    echo "📦 Installing project dependencies..."
    npm install
    echo "🌐 Installing browser engine..."
    npx playwright install chromium
fi

# 3. Open the dashboard in the default browser
echo "🖥️  Opening Dashboard at http://localhost:3000..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://localhost:3000
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open http://localhost:3000
else
    # Fallback for Windows (git bash)
    start http://localhost:3000
fi

# 4. Start the server
echo "✅ Everything is ready! Starting the engine..."
node server.js
