import OpenAI from 'openai';
import { config } from '../config.js';
import { RESPONSE_SCHEMA, JUDGE_SCHEMA } from './prompt.js';

let client;
const getClient = () => {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY не задан в .env');
  return (client ??= new OpenAI({ apiKey: config.openaiKey, baseURL: config.openaiBaseUrl, timeout: 30_000, maxRetries: 2 }));
};

// Reasoning-модели (gpt-5*, o-серия) не принимают temperature
const supportsTemperature = (m) => !/^(gpt-5|o\d)/i.test(m);

/** messages: [{role, content}] → { reply, revealed_fact_ids } */
export async function callPersona(messages) {
  const data = await callModel(messages, RESPONSE_SCHEMA, 600);
  return { reply: String(data.reply || '').trim(), revealed_fact_ids: Array.isArray(data.revealed_fact_ids) ? data.revealed_fact_ids : [] };
}

/** Оценка решения команды → { score, verdict, strengths, missed } */
export async function callJudge(messages) {
  return callModel(messages, JUDGE_SCHEMA, 900);
}

async function callModel(messages, schema, maxTokens) {
  const model = config.openaiModel;
  const req = { model, messages, response_format: { type: 'json_schema', json_schema: schema }, max_completion_tokens: maxTokens };
  let res;
  try {
    res = await getClient().chat.completions.create(supportsTemperature(model) ? { ...req, temperature: config.temperature } : req);
  } catch (e) {
    if (e.status !== 400 || !/temperature/i.test(e.message)) throw e;
    res = await getClient().chat.completions.create(req); // модель не принимает temperature
  }
  const msg = res.choices[0]?.message;
  if (msg?.refusal) throw new Error('Модель отказалась отвечать: ' + msg.refusal);
  return JSON.parse(msg?.content || '{}');
}
