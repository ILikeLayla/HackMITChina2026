import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('OAuth worker', () => {
	it('returns service metadata (unit style)', async () => {
		const request = new IncomingRequest('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			name: 'layla-calendar-oauth',
			endpoints: ['GET /oauth/google/start', 'GET /oauth/google/callback', 'GET /oauth/google/debug'],
		});
	});

	it('returns service metadata (integration style)', async () => {
		const response = await SELF.fetch('https://example.com');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			name: 'layla-calendar-oauth',
			endpoints: ['GET /oauth/google/start', 'GET /oauth/google/callback', 'GET /oauth/google/debug'],
		});
	});
});
