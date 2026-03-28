import type { CalendarTask } from './general_utils';

export interface GoogleCalendarNormalizedEvent {
    eventKey: string;
    title: string;
    date: string;
    time: string;
    note: string;
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
