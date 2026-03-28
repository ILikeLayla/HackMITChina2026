import type { CalendarTask } from './general_utils';

const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';

export const GOOGLE_CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

let googleIdentityScriptPromise: Promise<void> | null = null;

interface GoogleTokenResponse {
    access_token?: string;
    error?: string;
    error_description?: string;
}

interface GoogleCalendarListResponse {
    items?: Array<{
        id?: string;
        summary?: string;
        accessRole?: string;
    }>;
}

interface GoogleCalendarEventStart {
    date?: string;
    dateTime?: string;
}

interface GoogleCalendarEvent {
    id?: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: GoogleCalendarEventStart;
}

interface GoogleCalendarEventsResponse {
    items?: GoogleCalendarEvent[];
    nextPageToken?: string;
}

export interface GoogleCalendarNormalizedEvent {
    eventKey: string;
    title: string;
    date: string;
    time: string;
    note: string;
}

function loadGoogleIdentityScript() {
    if (window.google?.accounts?.oauth2) {
        return Promise.resolve();
    }

    if (googleIdentityScriptPromise) {
        return googleIdentityScriptPromise;
    }

    googleIdentityScriptPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_IDENTITY_SCRIPT}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity script.')), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = GOOGLE_IDENTITY_SCRIPT;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Google Identity script.'));
        document.head.appendChild(script);
    });

    return googleIdentityScriptPromise;
}

function formatDateAsTaskDate(dateLike: string) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTimeAsTaskTime(dateLike: string) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) {
        return '00:00';
    }

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function buildEventNote(event: GoogleCalendarEvent, calendarName: string) {
    const parts: string[] = [];
    if (event.description) {
        parts.push(event.description.trim());
    }
    if (event.location) {
        parts.push(`Location: ${event.location.trim()}`);
    }
    parts.push(`Imported from Google Calendar (${calendarName})`);
    return parts.filter(Boolean).join('\n\n');
}

async function fetchJson<T>(url: string, accessToken: string) {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Calendar API request failed (${response.status}): ${errorText}`);
    }

    return await response.json() as T;
}

async function fetchEventsForCalendar(
    accessToken: string,
    calendarId: string,
    calendarName: string,
    timeMin: string,
    timeMax: string,
): Promise<GoogleCalendarNormalizedEvent[]> {
    const normalized: GoogleCalendarNormalizedEvent[] = [];
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

        const encodedCalendarId = encodeURIComponent(calendarId);
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events?${params.toString()}`;
        const data = await fetchJson<GoogleCalendarEventsResponse>(url, accessToken);
        const items = data.items ?? [];

        for (const event of items) {
            if (event.status === 'cancelled') {
                continue;
            }

            const eventId = event.id?.trim();
            const dateValue = event.start?.date ?? event.start?.dateTime;
            if (!eventId || !dateValue) {
                continue;
            }

            const taskDate = event.start?.date
                ? event.start.date
                : formatDateAsTaskDate(dateValue);

            if (!taskDate) {
                continue;
            }

            const taskTime = event.start?.date ? '00:00' : formatTimeAsTaskTime(dateValue);
            normalized.push({
                eventKey: `${calendarId}:${eventId}`,
                title: event.summary?.trim() || '(No title)',
                date: taskDate,
                time: taskTime,
                note: buildEventNote(event, calendarName),
            });
        }

        nextPageToken = data.nextPageToken ?? null;
    } while (nextPageToken);

    return normalized;
}

export async function requestGoogleCalendarAccessToken(clientId: string) {
    await loadGoogleIdentityScript();

    const origin = window.location.origin;
    const protocol = window.location.protocol;
    const isHttpLike = protocol === 'http:' || protocol === 'https:';
    if (!isHttpLike) {
        throw new Error(
            `Google JS OAuth only supports http(s) origins. Current origin is ${origin}. ` +
            'Run the app on localhost during development, or switch to a backend/device OAuth flow for desktop builds.',
        );
    }

    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
        throw new Error('Google OAuth client is not available in this environment.');
    }

    return await new Promise<string>((resolve, reject) => {
        const tokenClient = oauth2.initTokenClient({
            client_id: clientId,
            scope: GOOGLE_CALENDAR_READONLY_SCOPE,
            callback: (response: GoogleTokenResponse) => {
                if (response.error) {
                    reject(
                        new Error(
                            `Google OAuth rejected the request: ${response.error_description || response.error}. ` +
                            `Origin: ${origin}. Ensure this is a Web OAuth client and add this origin in Authorized JavaScript origins.`,
                        ),
                    );
                    return;
                }

                if (!response.access_token) {
                    reject(new Error('Google OAuth returned an empty access token.'));
                    return;
                }

                resolve(response.access_token);
            },
            error_callback: (nonOAuthError?: { type?: string }) => {
                const errorType = nonOAuthError?.type ?? 'unknown_error';
                reject(
                    new Error(
                        `Google OAuth request failed (${errorType}). Origin: ${origin}. ` +
                        'Common causes: popup blocked/closed, wrong OAuth client type, or missing Authorized JavaScript origin.',
                    ),
                );
            },
        });

        tokenClient.requestAccessToken({ prompt: 'consent' });
    });
}

export async function fetchGoogleCalendarEvents(
    accessToken: string,
    windowStart: Date,
    windowEnd: Date,
) {
    const timeMin = windowStart.toISOString();
    const timeMax = windowEnd.toISOString();

    const calendarList = await fetchJson<GoogleCalendarListResponse>(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false',
        accessToken,
    );

    const calendars = (calendarList.items ?? [])
        .map(item => ({
            id: item.id?.trim() ?? '',
            name: item.summary?.trim() || 'Unnamed calendar',
            accessRole: item.accessRole ?? '',
        }))
        .filter(item => Boolean(item.id) && item.accessRole !== 'none');

    const eventsByCalendar = await Promise.all(calendars.map(calendar => (
        fetchEventsForCalendar(accessToken, calendar.id, calendar.name, timeMin, timeMax)
    )));

    return eventsByCalendar.flat();
}

export function buildTaskFromGoogleEvent(event: GoogleCalendarNormalizedEvent, taskId: number): CalendarTask {
    return {
        id: taskId,
        title: event.title,
        date: event.date,
        type: 'google',
        time: event.time,
        note: event.note,
    };
}

declare global {
    interface Window {
        google?: {
            accounts?: {
                oauth2?: {
                    initTokenClient: (config: {
                        client_id: string;
                        scope: string;
                        callback: (response: GoogleTokenResponse) => void;
                        error_callback?: () => void;
                    }) => {
                        requestAccessToken: (options?: { prompt?: string }) => void;
                    };
                };
            };
        };
    }
}
