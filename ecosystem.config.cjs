// pm2-конфиг для VPS: бот (24/7) + SEO-агент (cron 03:00 МСК = 00:00 UTC).
module.exports = {
  apps: [
    {
      name: 'nalog-bot',
      script: './scripts/bot/bot.mjs',
      cwd: '/opt/nalog-expert',
      autorestart: true,
      max_restarts: 30,
      restart_delay: 5000,
      out_file: '/opt/nalog-expert/logs/bot.out.log',
      error_file: '/opt/nalog-expert/logs/bot.err.log',
    },
    {
      name: 'nalog-seo-agent',
      script: './scripts/seo-agent/run.mjs',
      cwd: '/opt/nalog-expert',
      autorestart: false,
      cron_restart: '0 0 * * *', // 03:00 МСК (сервер в UTC)
      out_file: '/opt/nalog-expert/logs/agent.out.log',
      error_file: '/opt/nalog-expert/logs/agent.err.log',
    },
  ],
};
