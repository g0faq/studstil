import { Bot, GrammyError, HttpError } from 'grammy';
import { config } from '../config.js';
import { store } from '../core/db.js';
import { loadScenarios } from '../core/scenarios.js';
import { enterCode, handleMessage, resetSession, getSessionState } from '../core/engine.js';

const ASK_CODE = 'Здравствуйте! 👋 Введите, пожалуйста, код вашей команды.';
const BAD_CODE = 'Такого кода нет 🤔 Проверьте, пожалуйста, и введите код команды ещё раз.';

const ERRORS = {
  too_long: `Слишком длинное сообщение. Сформулируйте вопрос короче (до ${config.maxInputChars} символов).`,
  rate_limited: '⏳ Не так быстро: клиент ещё думает над прошлым вопросом.',
  already_finished: '✅ Ваша команда уже выяснила запрос клиента. Работайте над заданием! (/restart — начать заново)',
  llm_error: '⚠️ Клиент отвлёкся (ошибка связи). Отправьте вопрос ещё раз.',
  empty: 'Напишите вопрос текстом.',
};

const isAdmin = (ctx) => config.adminIds.includes(String(ctx.from?.id));
const who = (ctx) => [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') + (ctx.from?.username ? ` @${ctx.from.username}` : '');
const cut = (s, n = 3900) => (s.length > n ? s.slice(0, n) + '\n…' : s);

export function createBot() {
  if (!config.telegramToken) throw new Error('TELEGRAM_BOT_TOKEN не задан в .env');
  const bot = new Bot(config.telegramToken);

  bot.command('start', async (ctx) => {
    const st = await getSessionState(ctx.chat.id);
    if (st && !st.session.finished) {
      return ctx.reply(`У вас уже идёт разговор с клиентом (${st.scenario.persona.name}). Продолжайте задавать вопросы.\n/restart — начать заново с вводом кода.`);
    }
    await resetSession(ctx.chat.id);
    return ctx.reply(ASK_CODE);
  });

  bot.command('restart', async (ctx) => {
    await resetSession(ctx.chat.id);
    return ctx.reply('Сессия сброшена. ' + ASK_CODE);
  });

  bot.command('help', (ctx) =>
    ctx.reply('Задавайте клиенту вопросы и выясните, с чем он пришёл.\n/restart — начать заново' +
      (isAdmin(ctx) ? '\n\nАдмин: /status, /reset_all, /log <chat_id>' : '')));

  // --- Админ ---
  bot.command('status', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const scenarios = loadScenarios();
    const sessions = await store.activeSessions();
    if (!sessions.length) return ctx.reply('Активных сессий нет.');
    const lines = [];
    for (const [id, sc] of scenarios) {
      const group = sessions.filter((s) => s.scenario_id === id);
      if (!group.length) continue;
      const req = sc.facts.filter((f) => f.required);
      lines.push(`\n📋 ${sc.persona.name} (${id}, код ${sc.access_code}) — сессий: ${group.length}`);
      for (const s of group) {
        const open = req.filter((f) => s.revealed.includes(f.id)).length;
        const bar = req.map((f) => (s.revealed.includes(f.id) ? '●' : '○')).join('');
        lines.push(`${s.finished ? '✅' : '⏳'} ${bar} ${open}/${req.length} (+${s.revealed.length - open} доп.) — ${s.label || '?'} [${s.chat_id}]`);
      }
      lines.push('   ' + req.map((f, i) => `${i + 1}.${f.id}`).join(' '));
    }
    return ctx.reply(cut(lines.join('\n').trim()));
  });

  bot.command('reset_all', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const n = await store.resetAll();
    return ctx.reply(`Сброшено сессий: ${n}. Логи сохранены (помечены как архив). Участникам нужно заново нажать /start.`);
  });

  bot.command('log', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const chatId = ctx.match?.trim();
    if (!chatId) return ctx.reply('Использование: /log <chat_id> (chat_id видно в /status)');
    const rows = await store.log(chatId, 30);
    if (!rows.length) return ctx.reply('Сообщений нет.');
    const icon = { user: '🧑‍🎓', assistant: '👩', system: '⚙️' };
    const text = rows.map((r) => {
      const rv = r.revealed?.length ? ` 🔓${r.revealed.join(', ')}` : '';
      return `${r.archived ? '🗄' : ''}${icon[r.role] || ''} ${r.content}${rv}`;
    }).join('\n\n');
    return ctx.reply(cut(text));
  });

  // --- Диалог ---
  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    if (!(await getSessionState(chatId))) {
      const res = await enterCode(chatId, text, who(ctx));
      if (!res.ok) return ctx.reply(BAD_CODE);
      return ctx.reply(`✅ Код принят. К вам пришёл клиент. Выясните, с чем он пришёл!\n\n👩 ${res.greeting}`);
    }

    await ctx.replyWithChatAction('typing').catch(() => {});
    const res = await handleMessage(chatId, text);
    if (res.error) return ctx.reply(ERRORS[res.error] || 'Ошибка. Попробуйте ещё раз.');

    await ctx.reply(res.reply);
    if (res.finished) {
      await ctx.reply(`🎉 Вы выяснили запрос клиента!\n\n${res.final.message}`);
      const f = res.final;
      await ctx.reply(['🎯 Задание команде:', ...f.tasks.map((t) => `— ${t}`), f.task_time].filter(Boolean).join('\n'));
    }
  });

  bot.on('message', (ctx) => ctx.reply('Пожалуйста, пишите текстом 🙂'));

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error('[telegram] ошибка запроса:', e.description);
    else if (e instanceof HttpError) console.error('[telegram] нет связи с Telegram:', e.message);
    else console.error('[bot]', e);
  });

  return bot;
}
