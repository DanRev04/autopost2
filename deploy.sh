#!/bin/bash
# Деплой weekend-events-bot через PM2
# Работает ТОЛЬКО с этим ботом, не трогает другие PM2 приложения
#
# Использование:
#   ./deploy.sh          — запустить или перезапустить бота
#   ./deploy.sh stop     — остановить бота
#   ./deploy.sh logs     — показать логи
#   ./deploy.sh status   — статус бота

APP_NAME="weekend-events-bot"
DIR="$(cd "$(dirname "$0")" && pwd)"

case "${1:-deploy}" in
  deploy)
    cd "$DIR"
    echo "📦 Устанавливаю зависимости..."
    npm ci --omit=dev

    mkdir -p logs data

    # Если бот уже запущен — перезапускаем, иначе стартуем
    if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
      echo "🔄 Перезапускаю бота..."
      pm2 restart "$APP_NAME" --update-env
    else
      echo "🚀 Запускаю бота..."
      pm2 start ecosystem.config.cjs
    fi

    pm2 save
    echo "✅ Готово!"
    pm2 status
    ;;

  stop)
    echo "🛑 Останавливаю бота..."
    pm2 stop "$APP_NAME"
    pm2 save
    echo "✅ Бот остановлен (но не удалён из PM2)"
    ;;

  logs)
    pm2 logs "$APP_NAME" --lines 100
    ;;

  status)
    pm2 describe "$APP_NAME"
    ;;

  *)
    echo "Использование: $0 {deploy|stop|logs|status}"
    ;;
esac
