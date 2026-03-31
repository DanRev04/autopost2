#!/bin/bash
# ------------------------------------------------------------------
# Safe Update Script for weekend-events-bot
# This script ONLY affects this bot and nothing else on the server.
# ------------------------------------------------------------------

APP_NAME="weekend-events-bot"

echo "📍 Checking current directory..."
if [ ! -f "package.json" ]; then
    echo "❌ Error: This script must be run from the bot's root directory."
    exit 1
fi

echo "🔄 Pulling latest changes from GitHub..."
git pull origin main

echo "📦 Updating dependencies (if needed)..."
npm ci --omit=dev

# We use Targeted PM2 commands specifying the APP_NAME
# to ensure other applications are NOT affected.
if pm2 list | grep -q "$APP_NAME"; then
    echo "⚙️  Restarting ONLY $APP_NAME..."
    pm2 restart "$APP_NAME" --update-env
else
    echo "🚀 Starting $APP_NAME for the first time..."
    pm2 start ecosystem.config.cjs
fi

echo "✅ Update complete! Other PM2 processes were not touched."
pm2 status $APP_NAME
