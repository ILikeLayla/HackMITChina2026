interface Env {
	GOOGLE_CLIENT_ID: string;
	GOOGLE_REDIRECT_URI: string;
	GOOGLE_CLIENT_SECRET: string;
}

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

type CalendarListResponse = {
	items?: Array<{
		id?: string;
		summary?: string;
		accessRole?: string;
	}>;
};

type EventListResponse = {
	items?: Array<{
		id?: string;
		status?: string;
		summary?: string;
		description?: string;
		location?: string;
		start?: {
			date?: string;
			dateTime?: string;
		};
	}>;
	nextPageToken?: string;
};

function html(content: string, status = 200) {
	return new Response(content, {
		status,
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
		},
	});
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
		},
	});
}

function parseCookieValue(cookieHeader: string | null, key: string) {
	if (!cookieHeader) {
		return null;
	}
	for (const part of cookieHeader.split(';')) {
		const [name, ...rest] = part.trim().split('=');
		if (name === key) {
			return decodeURIComponent(rest.join('='));
		}
	}
	return null;
}

function buildState() {
	const random = crypto.randomUUID().replace(/-/g, '');
	const now = Date.now().toString(36);
	return `${now}.${random}`;
}

function isAllowedReturnTo(raw: string) {
	try {
		const url = new URL(raw);
		if (url.protocol !== 'http:') {
			return false;
		}
		return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
	} catch {
		return false;
	}
}

function normalizeDate(dateTimeText: string) {
	const date = new Date(dateTimeText);
	if (Number.isNaN(date.getTime())) {
		return null;
	}
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function normalizeTime(dateTimeText: string) {
	const date = new Date(dateTimeText);
	if (Number.isNaN(date.getTime())) {
		return '00:00';
	}
	const h = String(date.getHours()).padStart(2, '0');
	const min = String(date.getMinutes()).padStart(2, '0');
	return `${h}:${min}`;
}

async function fetchGoogleJson<T>(url: string, accessToken: string) {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Google API request failed (${response.status}): ${body}`);
	}

	return (await response.json()) as T;
}

async function fetchCalendarEvents(accessToken: string) {
	const now = new Date();
	const timeMinDate = new Date(now);
	timeMinDate.setMonth(timeMinDate.getMonth() - 6);
	const timeMaxDate = new Date(now);
	timeMaxDate.setMonth(timeMaxDate.getMonth() + 12);

	const timeMin = timeMinDate.toISOString();
	const timeMax = timeMaxDate.toISOString();

	const calendarList = await fetchGoogleJson<CalendarListResponse>(
		'https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false',
		accessToken,
	);

	const result: Array<{
		eventKey: string;
		title: string;
		date: string;
		time: string;
		note: string;
	}> = [];

	for (const calendar of calendarList.items ?? []) {
		const calendarId = calendar.id?.trim();
		if (!calendarId || calendar.accessRole === 'none') {
			continue;
		}

		const calendarName = calendar.summary?.trim() || 'Unnamed calendar';
		let nextPageToken: string | null = null;

		do {
			const params = new URLSearchParams({
				singleEvents: 'true',
				orderBy: 'startTime',
				maxResults: '2500',
				timeMin,
				timeMax,
			});
			if (nextPageToken) {
				params.set('pageToken', nextPageToken);
			}

			const eventsUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
			const eventsPayload = await fetchGoogleJson<EventListResponse>(eventsUrl, accessToken);

			for (const event of eventsPayload.items ?? []) {
				if (event.status === 'cancelled') {
					continue;
				}

				const eventId = event.id?.trim();
				const allDayDate = event.start?.date?.trim();
				const startDateTime = event.start?.dateTime?.trim();
				if (!eventId || (!allDayDate && !startDateTime)) {
					continue;
				}

				const date = allDayDate ?? normalizeDate(startDateTime ?? '') ?? '1970-01-01';
				const time = allDayDate ? '00:00' : normalizeTime(startDateTime ?? '');
				const noteParts: string[] = [];
				if (event.description?.trim()) {
					noteParts.push(event.description.trim());
				}
				if (event.location?.trim()) {
					noteParts.push(`Location: ${event.location.trim()}`);
				}
				noteParts.push(`Imported from Google Calendar (${calendarName})`);

				result.push({
					eventKey: `${calendarId}:${eventId}`,
					title: event.summary?.trim() || '(No title)',
					date,
					time,
					note: noteParts.join('\n\n'),
				});
			}

			nextPageToken = eventsPayload.nextPageToken ?? null;
		} while (nextPageToken);
	}

	return result;
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/') {
			return json({
				name: 'layla-calendar-oauth',
				endpoints: [
					'GET /oauth/google/start',
					'GET /oauth/google/callback',
					'GET /oauth/google/debug',
				],
			});
		}

		if (url.pathname === '/oauth/google/debug') {
			const sampleState = buildState();
			const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
			authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
			authUrl.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
			authUrl.searchParams.set('response_type', 'code');
			authUrl.searchParams.set('scope', GOOGLE_SCOPE);
			authUrl.searchParams.set('access_type', 'offline');
			authUrl.searchParams.set('prompt', 'consent');
			authUrl.searchParams.set('state', sampleState);

			return json({
				googleClientId: env.GOOGLE_CLIENT_ID,
				googleRedirectUri: env.GOOGLE_REDIRECT_URI,
				sampleAuthUrl: authUrl.toString(),
			});
		}

		if (url.pathname === '/oauth/google/start') {
			const state = buildState();
			const nonce = Date.now().toString(36);
			const returnTo = url.searchParams.get('return_to')?.trim() ?? '';
			const safeReturnTo = isAllowedReturnTo(returnTo) ? returnTo : '';
			const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
			authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
			authUrl.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
			authUrl.searchParams.set('response_type', 'code');
			authUrl.searchParams.set('scope', GOOGLE_SCOPE);
			authUrl.searchParams.set('access_type', 'offline');
			authUrl.searchParams.set('prompt', 'consent');
			authUrl.searchParams.set('state', state);
			authUrl.searchParams.set('nonce', nonce);

			const headers = new Headers({
				location: authUrl.toString(),
				'cache-control': 'no-store, no-cache, max-age=0, must-revalidate',
				pragma: 'no-cache',
				expires: '0',
			});
			headers.append('set-cookie', `oauth_state=${encodeURIComponent(state)}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/oauth/google/callback`);
			if (safeReturnTo) {
				headers.append('set-cookie', `oauth_return_to=${encodeURIComponent(safeReturnTo)}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/oauth/google/callback`);
			}

			return new Response(null, {
				status: 302,
				headers,
			});
		}

		if (url.pathname === '/oauth/google/callback') {
			const state = url.searchParams.get('state');
			const expectedState = parseCookieValue(request.headers.get('cookie'), 'oauth_state');
			const returnTo = parseCookieValue(request.headers.get('cookie'), 'oauth_return_to');
			if (!state || !expectedState || state !== expectedState) {
				if (returnTo && isAllowedReturnTo(returnTo)) {
					const redirect = new URL(returnTo);
					redirect.searchParams.set('error', 'invalid_state');
					redirect.searchParams.set('message', 'OAuth state verification failed.');
					return Response.redirect(redirect.toString(), 302);
				}
				return json({ error: 'invalid_state', message: 'OAuth state verification failed.' }, 400);
			}

			const oauthError = url.searchParams.get('error');
			if (oauthError) {
				if (returnTo && isAllowedReturnTo(returnTo)) {
					const redirect = new URL(returnTo);
					redirect.searchParams.set('error', oauthError);
					redirect.searchParams.set('message', 'Google OAuth returned an error.');
					return Response.redirect(redirect.toString(), 302);
				}
				return json({ error: oauthError, message: 'Google OAuth returned an error.' }, 400);
			}

			const code = url.searchParams.get('code');
			if (!code) {
				if (returnTo && isAllowedReturnTo(returnTo)) {
					const redirect = new URL(returnTo);
					redirect.searchParams.set('error', 'missing_code');
					redirect.searchParams.set('message', 'Authorization code is missing.');
					return Response.redirect(redirect.toString(), 302);
				}
				return json({ error: 'missing_code', message: 'Authorization code is missing.' }, 400);
			}

			const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					client_id: env.GOOGLE_CLIENT_ID,
					client_secret: env.GOOGLE_CLIENT_SECRET,
					code,
					grant_type: 'authorization_code',
					redirect_uri: env.GOOGLE_REDIRECT_URI,
				}).toString(),
			});

			if (!tokenResponse.ok) {
				if (returnTo && isAllowedReturnTo(returnTo)) {
					const redirect = new URL(returnTo);
					redirect.searchParams.set('error', 'token_exchange_failed');
					redirect.searchParams.set('message', `Token exchange failed with status ${tokenResponse.status}.`);
					return Response.redirect(redirect.toString(), 302);
				}
				return json({
					error: 'token_exchange_failed',
					status: tokenResponse.status,
					details: await tokenResponse.text(),
				}, 400);
			}

			const tokenPayload = (await tokenResponse.json()) as {
				access_token?: string;
				expires_in?: number;
				scope?: string;
				token_type?: string;
			};

			if (!tokenPayload.access_token) {
				if (returnTo && isAllowedReturnTo(returnTo)) {
					const redirect = new URL(returnTo);
					redirect.searchParams.set('error', 'missing_access_token');
					redirect.searchParams.set('message', 'Token exchange succeeded but access token is missing.');
					return Response.redirect(redirect.toString(), 302);
				}
				return json({ error: 'missing_access_token', message: 'Token exchange succeeded but access token is missing.' }, 400);
			}

			if (returnTo && isAllowedReturnTo(returnTo)) {
				const redirect = new URL(returnTo);
				redirect.searchParams.set('access_token', tokenPayload.access_token);
				if (tokenPayload.expires_in !== undefined) {
					redirect.searchParams.set('expires_in', String(tokenPayload.expires_in));
				}
				redirect.searchParams.set('token_type', tokenPayload.token_type ?? 'Bearer');
				return Response.redirect(redirect.toString(), 302);
			}

			const events = await fetchCalendarEvents(tokenPayload.access_token);
			const preview = events.slice(0, 10);
			return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Layla OAuth Success</title>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 24px; color: #1f2937; }
    .card { max-width: 860px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; }
    h1 { margin-top: 0; font-size: 22px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #111827; color: #e5e7eb; padding: 12px; border-radius: 8px; }
    .meta { color: #4b5563; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Google OAuth completed</h1>
    <div class="meta">Fetched ${events.length} events. You can close this page.</div>
    <pre>${JSON.stringify({ ok: true, preview }, null, 2)}</pre>
  </div>
</body>
</html>`);
		}

		return json({ error: 'not_found' }, 404);
	},
} satisfies ExportedHandler<Env>;
