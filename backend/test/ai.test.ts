import { OpenAI } from 'openai';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { AiClient } from '../src/ai/insights.js';
import { createOpenAiClient, mapAiError } from '../src/ai/insights.js';
import { loadConfig } from '../src/config.js';
import { makeTestApp, REPORT_DATE, sample } from './helpers.js';

const VALID = JSON.stringify({ summary: 'Leads were 271.', observations: ['271 leads'], recommendations: ['Call back overdue leads'], dataGaps: [] });

async function setup(client: AiClient | null, overrides = {}) {
  const ctx = await makeTestApp({ OPENAI_API_KEY: client ? 'sk-test' : undefined, ...overrides }, { aiClient: client });
  const sid = (await request(ctx.app).post('/api/sessions').send({ reportingDate: REPORT_DATE })).body.id;
  await request(ctx.app).post(`/api/sessions/${sid}/files`).attach('files', sample('01_study-abroad-dubai_leads.xlsx')).attach('files', sample('06_ad-spend.xlsx'));
  await request(ctx.app).post(`/api/sessions/${sid}/process`).send({});
  return { ctx, sid };
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('AI insights', () => {
  it('sends only aggregated, non-identifying statistics', async () => {
    const seen: string[] = [];
    const client: AiClient = { complete: async ({ user, system }) => (seen.push(system, user), VALID) };
    const { ctx, sid } = await setup(client);
    cleanup = ctx.cleanup;
    const res = await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'eod' });
    expect(res.status).toBe(200);
    expect(res.body.insight.summary).toBe('Leads were 271.');
    expect(res.body.insight.counsellorLegend).toBeTruthy();
    const prompt = seen.join('\n');
    expect(prompt).toContain('REPORT DATA');
    expect(prompt).not.toMatch(/@example\.com/);
    expect(prompt).not.toMatch(/9000\d{6}/);
    expect(prompt).not.toMatch(/Testwala|Samplekar|Demoji|Fictiona|Mockerjee|Dummyram|Placeholderan|Synthetica/);
    expect(prompt).not.toMatch(/Priya Counsellor|Rahul Advisor/); // pseudonymised by default
    expect(prompt).toContain('Counsellor 1');
    expect(prompt).toMatch(/Use ONLY the figures/);
  });

  it('answers questions and rejects empty questions', async () => {
    const { ctx, sid } = await setup({ complete: async () => VALID });
    cleanup = ctx.cleanup;
    expect((await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'question' })).status).toBe(400);
    expect((await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'question', question: 'Which campaign had the lowest CPL?' })).status).toBe(200);
  });

  it('handles timeouts gracefully', async () => {
    const { ctx, sid } = await setup({
      complete: async () => {
        throw new OpenAI.APIConnectionTimeoutError();
      },
    });
    cleanup = ctx.cleanup;
    const res = await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'summary' });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('AI_TIMEOUT');
    // Reports are unaffected by AI failures.
    expect((await request(ctx.app).get(`/api/sessions/${sid}/report`)).status).toBe(200);
  });

  it('handles invalid model output', async () => {
    const { ctx, sid } = await setup({ complete: async () => 'not json' });
    cleanup = ctx.cleanup;
    const res = await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'summary' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_INVALID_RESPONSE');
  });

  it('enforces the per-session request limit', async () => {
    const { ctx, sid } = await setup({ complete: async () => VALID }, { AI_MAX_REQUESTS_PER_SESSION: 2 });
    cleanup = ctx.cleanup;
    expect((await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'summary' })).status).toBe(200);
    expect((await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'summary' })).status).toBe(200);
    const third = await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'summary' });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('AI_SESSION_LIMIT');
  });

  it('enforces the per-minute rate limit', async () => {
    const { ctx, sid } = await setup({ complete: async () => VALID }, { AI_RATE_LIMIT_PER_MINUTE: 1 });
    cleanup = ctx.cleanup;
    expect((await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'summary' })).status).toBe(200);
    expect((await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'summary' })).status).toBe(429);
  });

  it('maps SDK errors to clear codes', () => {
    const headers = new Headers();
    expect(mapAiError(new OpenAI.AuthenticationError(401, {}, 'bad key', headers)).code).toBe('AI_AUTH_FAILED');
    expect(mapAiError(new OpenAI.RateLimitError(429, {}, 'slow', headers)).code).toBe('AI_RATE_LIMITED');
    expect(mapAiError(new OpenAI.NotFoundError(404, {}, 'no model', headers)).code).toBe('AI_MODEL_NOT_FOUND');
    expect(mapAiError(new OpenAI.APIConnectionError({ message: 'down' })).code).toBe('AI_UNAVAILABLE');
    expect(mapAiError(new Error('x')).code).toBe('AI_ERROR');
  });

  it('no client is created without an API key', () => {
    expect(createOpenAiClient(loadConfig({ NODE_ENV: 'test' }))).toBeNull();
    expect(createOpenAiClient(loadConfig({ NODE_ENV: 'test', OPENAI_API_KEY: '   ' }))).toBeNull();
  });

  it('an invalid key fails with AI_AUTH_FAILED through the real SDK (network permitting)', async () => {
    const config = loadConfig({ NODE_ENV: 'test', OPENAI_API_KEY: 'sk-invalid-test-key', OPENAI_TIMEOUT_MS: '15000' });
    const client = createOpenAiClient(config)!;
    try {
      await client.complete({ system: 's', user: 'u', schema: { type: 'object', additionalProperties: false, properties: {}, required: [] } });
      throw new Error('expected failure');
    } catch (e) {
      const code = mapAiError(e).code;
      // Offline environments surface as AI_UNAVAILABLE/AI_TIMEOUT instead of an auth failure.
      expect(['AI_AUTH_FAILED', 'AI_UNAVAILABLE', 'AI_TIMEOUT']).toContain(code);
    }
  });
});
