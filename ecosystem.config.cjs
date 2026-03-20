module.exports = {
  apps: [{
    name: 'weekend-events-bot',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production'
    },
    // Logs
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    // Restart policy
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 5000,
    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 10000
  }]
};
