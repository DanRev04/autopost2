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

# 2. Trigger Server Update
echo "🌐 Connecting to server to pull changes and restart..."
# We use the IP and credentials from deploy_pm2.sh
SERVER="root@5.35.93.124"
REMOTE_CMD="cd /var/www/autopost2 && ./prod_update.sh"

# If sshpass is installed, we can use it, otherwise standard ssh
if command -v sshpass >/dev/null 2>&1; then
    sshpass -p "%AnVwYknX3RV" ssh -o StrictHostKeyChecking=no $SERVER "$REMOTE_CMD"
else
    echo "⚠️  sshpass not found. Please enter server password when prompted."
    ssh $SERVER "$REMOTE_CMD"
fi

echo "🎉 All done! Your bot should be updated on the server."
