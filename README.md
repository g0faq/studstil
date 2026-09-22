# Beauty Case — виртуальный клиент для открытого урока

Студенты заходят на сайт по QR-коду, вводят код команды и разговаривают с «клиенткой» (Ольга, Марина или Алина). Клиентку играет модель OpenAI. Вопросами нужно выяснить настоящий запрос. Когда все обязательные факты раскрыты, команда получает задание. Преподаватель видит прогресс команд на табло.

```
Телефон студента ──► domain.ru (GitHub Pages, папка docs/) ──► api.domain.ru (VPS, Node) ──► OpenAI
Проектор        ──► domain.ru/board.html ─────────────────────┘
Telegram-бот (необязательно) ─────────────────────────────────┘
```
Ключ OpenAI хранится только на сервере. GitHub Pages отдаёт статику и сам не может обращаться к OpenAI.

## Локальный запуск
Нужен Node.js 20+.
```bash
npm install
cp .env.example .env      # OPENAI_API_KEY, ADMIN_KEY
npm start                 # http://localhost:8080 — сайт, http://localhost:8080/board.html — табло
```
Локально сервер сам раздаёт `docs/`, поэтому сайт и API работают на одном адресе.

| Переменная | Что это |
|---|---|
| `OPENAI_API_KEY` | ключ OpenAI |
| `OPENAI_MODEL` | `gpt-5.6-luna` (temperature у неё фиксированная, код её не передаёт) |
| `OPENAI_BASE_URL` | необязательно, OpenAI-совместимый прокси |
| `ADMIN_KEY` | ключ табло преподавателя (`board.html?key=…`) |
| `WEB_ORIGIN` | адрес сайта для CORS, например `https://domain.ru,https://www.domain.ru` |
| `SERVE_STATIC` | `0` на VPS (сайт раздаёт GitHub Pages) |
| `TELEGRAM_BOT_TOKEN`, `ADMIN_IDS` | необязательно: Telegram-бот работает параллельно с сайтом |
| `HISTORY_LIMIT`, `MAX_INPUT_CHARS`, `RATE_LIMIT_MS`, `DB_PATH` | тонкая настройка |

## Сценарии
Каждая клиентка описана в своём файле `scenarios/<id>.json`. Шаблон: `scenarios/_template.json`, файлы с `_` в начале не загружаются. После правки выполните `npm run check`. Изменения подхватываются без перезапуска.

Поля:
- `access_code` — код команды.
- `persona` — кто клиентка и как говорит.
- `greeting` — первое сообщение.
- `facts[]`:
  - `label` — подпись в досье;
  - `text` — суть факта;
  - `reveal_when` — на какой вопрос клиентка его раскрывает;
  - `hint` — реплика из методички;
  - `level` — 1 (охотно), 2 (коротко) или 3 (только на вопрос о чувствах);
  - `required` — нужен ли факт для разгадки.
- `deflection_style` — как клиентка отвечает на общие вопросы.
- `triggers` — подсказки, если команда молчит 30 секунд.
- `final_message`, `problem`, `tasks`, `task_time` — экран итога.
- `ui` — цвет, подпись, цитата на карточке, быстрые вопросы.

## Проверка без сайта
```bash
npm run chat -- --scenario olga   # диалог в терминале (/facts, /restart, /exit)
npm run eval                      # общие вопросы не раскрывают факты, точные раскрывают
```

## Публикация
### 1. Домен в коде
```bash
npm run set-domain -- domain.ru
```
Команда прописывает домен в `docs/CNAME`, `docs/config.js`, `deploy/Caddyfile` и `.env.example`.

### 2. DNS в Timeweb
Раздел «Домены» → домен → «DNS»:

| Тип | Имя | Значение |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | `<github-логин>.github.io.` |
| A | api | IP вашего VPS |

Старые A-записи для `@` (заглушка Timeweb) нужно удалить. NS-серверы должны остаться Timeweb (`ns1.timeweb.ru` … `ns4.timeweb.org`).

### 3. GitHub Pages
Залить репозиторий на GitHub, затем Settings → Pages → Deploy from a branch → `main` / `/docs`. В поле Custom domain указать `domain.ru` и после выпуска сертификата включить Enforce HTTPS (сертификат выпускается от 15 минут до 24 часов после обновления DNS).

### 4. API на VPS вне РФ
OpenAI не работает с российских IP. Подойдёт, например, Timeweb Cloud в Нидерландах или Германии (Ubuntu 24.04, минимальный тариф).
```bash
scp -r . root@IP:/root/beauty-case     # или git clone
ssh root@IP 'bash /root/beauty-case/deploy/setup-vps.sh api.domain.ru'
```
Дальше: скопировать проект в `/opt/beauty-case`, выполнить `npm ci --omit=dev`, заполнить `.env` (`SERVE_STATIC=0`, `WEB_ORIGIN=https://domain.ru,https://www.domain.ru`), затем `systemctl restart beauty-case`. Проверка: `curl https://api.domain.ru/api/health`. HTTPS для `api.` Caddy выпускает автоматически.

Если сервер в РФ, можно указать в `OPENAI_BASE_URL` OpenAI-совместимый прокси с поддержкой `response_format: json_schema`.

### 5. QR-код
```bash
npm run qr -- https://domain.ru
```

## На уроке
1. Открыть на проекторе `https://domain.ru/board.html?key=ADMIN_KEY`. Там есть таймер (клик — старт или пауза, двойной клик — сброс, длительность задаётся через `?min=15`) и кнопка «Сбросить все сессии».
2. Каждая команда получает свой код: 101 — Ольга, 202 — Марина, 303 — Алина.
3. Полный лог всех диалогов хранится в `data/bot.db` (таблица `messages`).
