#!/bin/bash

# Configuration
SERVER="root@5.35.93.124"
SERVER_PASS="%AnVwYknX3RV"
REMOTE_DIR="/var/www/autopost2"
APP_NAME="autopost2"

SSH_CMD="sshpass -p $SERVER_PASS ssh -o StrictHostKeyChecking=no"
RSYNC_CMD="sshpass -p $SERVER_PASS rsync -avz --rsh='ssh -o StrictHostKeyChecking=no'"

echo "Начинаем деплой проекта $APP_NAME на сервер $SERVER..."

# 1. Создаем папку на сервере, если ее нет
echo "Создаем директорию $REMOTE_DIR..."
$SSH_CMD $SERVER "mkdir -p $REMOTE_DIR"

# 2. Копируем файлы (исключая ненужное)
echo "Копируем файлы проекта..."
sshpass -p "$SERVER_PASS" rsync -avz \
    --rsh="ssh -o StrictHostKeyChecking=no" \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'data' \
    --exclude 'deploy_pm2.sh' \
    ./ $SERVER:$REMOTE_DIR/

# 3. Подключаемся по SSH, устанавливаем зависимости и перезапускаем PM2
echo "Обновляем зависимости и перезапускаем PM2..."
$SSH_CMD $SERVER "cd $REMOTE_DIR && \
    export PATH=\$PATH:/usr/local/bin:/usr/bin:/bin && \
    npm ci --only=production && \
    (pm2 restart $APP_NAME --update-env || pm2 start src/index.js --name \"$APP_NAME\") && \
    pm2 save"

echo "Деплой успешно завершен!"
