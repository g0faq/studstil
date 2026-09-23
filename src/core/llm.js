import OpenAI from 'openai';
import { config } from '../config.js';
import { RESPONSE_SCHEMA, JUDGE_SCHEMA, IMAGE_PROMPT_SCHEMA } from './prompt.js';

let client;
const getClient = () => {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY не задан в .env');
  return (client ??= new OpenAI({ apiKey: config.openaiKey, baseURL: config.openaiBaseUrl, timeout: 60_000, maxRetries: 2 }));
};

// Reasoning-модели (gpt-5*, o-серия) не принимают temperature
const supportsTemperature = (m) => !/^(gpt-5|o\d)/i.test(m);

/** Диалог с клиенткой: Luna. → { reply, revealed_fact_ids, usage } */
export async function callPersona(messages) {
  const out = await callModel(config.dialogModel, messages, RESPONSE_SCHEMA, 700);
  return {
    reply: String(out.data.reply || '').trim(),
    revealed_fact_ids: Array.isArray(out.data.revealed_fact_ids) ? out.data.revealed_fact_ids : [],
    client_reaction: out.data.client_reaction || 'neutral',
    usage: out.usage,
  };
}

/** Финальная оценка работы: Terra. → { data, usage } */
export async function callJudge(messages) {
  return callModel(config.evalModel, messages, JUDGE_SCHEMA, 2500);
}

/** Luna готовит инструкцию для редактирования фотографии. → { data, usage } */
export async function callImageInstruction(messages) {
  return callModel(config.dialogModel, messages, IMAGE_PROMPT_SCHEMA, 700);
}

/**
 * Редактирование исходной фотографии клиентки.
 * image — Buffer с исходником, instruction — что изменить.
 * → { b64, mime, usage }
 */
export async function editImage(image, filename, instruction) {
  const t0 = Date.now();
  const form = new FormData();
  form.append('model', config.imageModel);
  form.append('prompt', instruction);
  form.append('image', new Blob([image], { type: filename.endsWith('.png') ? 'image/png' : 'image/jpeg' }), filename);
  form.append('output_format', 'webp');
  form.append('quality', config.imageQuality);
  form.append('size', config.imageSize);

  const res = await fetch(`${(config.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiKey}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = (() => { try { return JSON.parse(text).error?.message; } catch { return null; } })() || text.slice(0, 200);
    throw Object.assign(new Error(`Генерация изображения: ${err}`), { status: res.status });
  }
  const json = JSON.parse(text);
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('Модель не вернула изображение');
  const usage = {
    model: config.imageModel, ms: Date.now() - t0,
    prompt_tokens: json.usage?.input_tokens ?? null,
    completion_tokens: json.usage?.output_tokens ?? null,
  };
  console.log(`[image] ${config.imageModel} ${usage.ms}ms ${Math.round(b64.length / 1366)}КБ`);
  return { b64, mime: 'image/webp', usage };
}

async function callModel(model, messages, schema, maxTokens) {
  const t0 = Date.now();
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
  const usage = {
    model, ms: Date.now() - t0,
    prompt_tokens: res.usage?.prompt_tokens ?? null,
    completion_tokens: res.usage?.completion_tokens ?? null,
  };
  console.log(`[llm] ${model} ${usage.ms}ms in=${usage.prompt_tokens} out=${usage.completion_tokens}`);
  return { data: JSON.parse(msg?.content || '{}'), usage };
}
