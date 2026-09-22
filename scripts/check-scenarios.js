// npm run check — проверить сценарии без запуска бота
import { loadScenarios } from '../src/core/scenarios.js';
try {
  for (const s of loadScenarios().values()) {
    console.log(`✅ ${s.id}: код "${s.access_code}", фактов ${s.facts.length} (обязательных ${s.facts.filter((f) => f.required).length})`);
  }
} catch (e) { console.error('❌', e.message); process.exit(1); }
