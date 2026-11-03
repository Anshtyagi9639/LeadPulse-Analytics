import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { makeTestApp } from './helpers.js';

const ALLOWED = 'https://lead-pulse-analytics-e8c7.vercel.app';
const CLIENT = '3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c';

type Ctx = Awaited<ReturnType<typeof makeTestApp>>;

describe('CORS', () => {
  let ctx: Ctx;

  beforeAll(async () => {
    // Trailing slash and spaces as an operator might type them into CORS_ORIGINS.
    const corsOrigins = loadConfig({ NODE_ENV: 'test', CORS_ORIGINS: ` ${ALLOWED}/ , http://localhost:3000` }).corsOrigins;
    ctx = await makeTestApp({ corsOrigins });
  });
  afterAll(async () => ctx.cleanup());

  it('answers the sessions preflight for an allowed origin with the methods and headers the portal sends', async () => {
    const res = await request(ctx.app)
      .options('/api/sessions')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-client-id');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type,X-Client-Id');
    // No cookies are used (the browser id travels in X-Client-Id), so credentials stay off.
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('adds the allow-origin header to the actual sessions request', async () => {
    const res = await request(ctx.app)
      .post('/api/sessions')
      .set('Origin', ALLOWED)
      .set('X-Client-Id', CLIENT)
      .send({ reportingDate: '2026-11-03' });
    expect(res.status).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-expose-headers']).toContain('Content-Disposition');
  });

  it('refuses the preflight of an unapproved origin without CORS headers', async () => {
    const res = await request(ctx.app)
      .options('/api/sessions')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_ORIGIN_NOT_ALLOWED');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not grant an unapproved origin on simple requests', async () => {
    const res = await request(ctx.app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS configuration', () => {
  it('requires CORS_ORIGINS in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: ' ' })).toThrow(/CORS_ORIGINS/);
  });

  it('rejects a wildcard origin in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(/"\*"/);
  });

  it('accepts a comma-separated list of explicit origins', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: `${ALLOWED},https://reports.example.org/` });
    expect(cfg.corsOrigins).toEqual([ALLOWED, 'https://reports.example.org']);
  });
});
