// Адрес API. Пусто = тот же сервер (локальный запуск через npm start).
// Для GitHub Pages: 'https://api.studstil.ru'
window.API_URL = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '' : 'https://api.studstil.ru';
