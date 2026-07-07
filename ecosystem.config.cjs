// pm2-конфиг для VPS: бот (24/7) + SEO-агент (cron 03:00 МСК = 00:00 UTC).
// Замени <project> на реальное имя/путь проекта при установке.
module.exports = {
  apps: [
    {
      name: '<project>-bot',
      script: './scripts/bot/bot.mjs',
      cwd: '/opt/<project>',
      autorestart: true,
      max_restarts: 30,
      restart_delay: 5000,
      out_file: '/opt/<project>/logs/bot.out.log',
      error_file: '/opt/<project>/logs/bot.err.log',
    },
    {
      name: '<project>-seo-agent',
      script: './scripts/seo-agent/run.mjs',
      cwd: '/opt/<project>',
      autorestart: false,
      cron_restart: '0 0 * * *', // 03:00 МСК (сервер в UTC)
      out_file: '/opt/<project>/logs/agent.out.log',
      error_file: '/opt/<project>/logs/agent.err.log',
    },
  ],
};
