// Vercel-функция: весь /api/* обрабатывает тот же код, что и локальный сервер.
import { handler } from '../src/adapters/http.js';

export default handler;
