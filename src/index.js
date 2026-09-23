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

// Проверка связи с моделью при старте: из России прямой доступ к OpenAI бывает закрыт,
// и лучше увидеть это в логах сразу, чем на уроке при первом вопросе клиентке.
(async () => {
  const base = (config.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${config.openaiKey || ''}` },
      signal: AbortSignal.timeout(12000),
    });
    console.log(`[проверка] OpenAI (${base}): ответ ${res.status} за ${Date.now() - t0} мс`);
  } catch (e) {
    console.error(`[проверка] OpenAI (${base}) недоступен за ${Date.now() - t0} мс: ${e.message}`);
  }
})();

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
