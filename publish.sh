#!/bin/bash
# ------------------------------------------------------------------
# UNIFIED DEPLOYMENT SCRIPT
# This script pushes changes to GitHub and updates the server.
# ------------------------------------------------------------------

echo "🚀 Starting unified deployment..."

# 1. Commit and Push
echo "📦 Committing and pushing changes..."
git add .
git commit -m "manual update: $(date +'%Y-%m-%d %H:%M:%S')"
git push origin main

if [ $? -eq 0 ]; then
    echo "✅ Pushed to GitHub successfully."
else
    echo "❌ Git push failed. Please check your connection or credentials."
    exit 1
fi

# 2. Sync Files to Server
echo "🌐 Syncing files to server via rsync..."
SERVER="root@5.35.93.124"
SERVER_PASS="%AnVwYknX3RV"
REMOTE_DIR="/var/www/autopost2"

# Use rsync with sshpass if available
RSYNC_CMD="rsync -avz --rsh='ssh -o StrictHostKeyChecking=no' --exclude 'node_modules' --exclude '.git' --exclude 'data' --exclude 'logs'"

if command -v sshpass >/dev/null 2>&1; then
    sshpass -p "$SERVER_PASS" $RSYNC_CMD ./ $SERVER:$REMOTE_DIR/
else
    echo "⚠️  sshpass not found. Please enter server password for rsync."
    $RSYNC_CMD ./ $SERVER:$REMOTE_DIR/
fi

# 3. Restart PM2 on Server
echo "⚙️  Restarting bot on server..."
REMOTE_RESTART="cd $REMOTE_DIR && npm ci --omit=dev && (pm2 restart weekend-events-bot --update-env || pm2 start ecosystem.config.cjs)"

if command -v sshpass >/dev/null 2>&1; then
    sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no $SERVER "$REMOTE_RESTART"
else
    ssh $SERVER "$REMOTE_RESTART"
fi

echo "🎉 All done! Your bot has been synced and updated on the server."
