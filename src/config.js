import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  openaiKey: process.env.OPENAI_API_KEY,
  // Диалог с клиенткой и финальная оценка — разные модели
  dialogModel: process.env.OPENAI_DIALOG_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  evalModel: process.env.OPENAI_EVALUATION_MODEL || 'gpt-5.6-terra',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  siteUrl: process.env.SITE_URL || 'https://studstil.ru',
  imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst',
  imageSize: process.env.OPENAI_IMAGE_SIZE || '1024x1536',
  imageQuality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
  temperature: num(process.env.OPENAI_TEMPERATURE, 0.7),
  adminIds: (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  historyLimit: num(process.env.HISTORY_LIMIT, 16),
  maxInputChars: num(process.env.MAX_INPUT_CHARS, 500),
  rateLimitMs: num(process.env.RATE_LIMIT_MS, 400),
  port: num(process.env.PORT, 8080),
  adminKey: process.env.ADMIN_KEY || '',
  webOrigins: (process.env.WEB_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean),
  serveStatic: process.env.SERVE_STATIC !== '0',
  // Сквозной код: пройти игру в тестовом режиме, не запуская игру в админке
  testCode: process.env.TEST_CODE || '14235867',
  gameMinutes: num(process.env.GAME_MINUTES, 7),
  dbPath: process.env.DB_PATH || 'data/bot.db',
};
