import { loadScenarios } from './core/scenarios.js';
import { storeKind } from './core/db.js';
import { config } from './config.js';
import { createHttpServer } from './adapters/http.js';

const scenarios = loadScenarios(); // падаем сразу, если сценарий битый
console.log(`Сценарии: ${[...scenarios.keys()].join(', ')} | хранилище: ${storeKind} | модель: ${config.openaiModel}${config.openaiBaseUrl ? ` через ${config.openaiBaseUrl}` : ''}`);

// Веб: API (+ статика docs/ для локального запуска)
const server = createHttpServer();
server.listen(config.port, () => console.log(`HTTP: http://localhost:${config.port}  (табло: /board.html?key=ADMIN_KEY)`));
if (!config.adminKey) console.warn('ADMIN_KEY пуст — табло преподавателя недоступно');

// Telegram: запускается, только если задан токен
let bot;
if (config.telegramToken) {
  try {
    const { createBot } = await import('./adapters/telegram.js');
    bot = createBot();
    await bot.api.setMyCommands([
      { command: 'start', description: 'Начать' },
      { command: 'restart', description: 'Сбросить и ввести код заново' },
      { command: 'help', description: 'Помощь' },
    ]);
    bot.start({ drop_pending_updates: true, onStart: (me) => console.log(`Telegram-бот @${me.username} запущен`) })
      .catch((e) => console.error('[telegram] бот остановлен:', e.message));
  } catch (e) {
    console.error('[telegram] не запустился, сайт работает без бота:', e.message);
    bot = null;
  }
}

const stop = () => { bot?.stop(); server.close(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
