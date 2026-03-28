import type { CalendarTask } from './general_utils';

export interface GoogleCalendarNormalizedEvent {
    eventKey: string;
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    note: string;
}

export function buildTaskFromGoogleEvent(event: GoogleCalendarNormalizedEvent, taskId: number): CalendarTask {
    return {
        id: taskId,
        title: event.title,
        date: event.date,
        type: 'google',
        commitmentCategory: 'undetermined',
        itemKind: 'event',
        ddl: '',
        startTime: event.startTime,
        endTime: event.endTime,
        note: event.note,
    };
}
