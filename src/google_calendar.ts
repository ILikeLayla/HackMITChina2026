import type { CalendarTask } from './general_utils';

const GOOGLE_TASKS_DESCRIPTION_MARKER = 'changes made to the title, description, or attachments will not be saved';
const GOOGLE_TASKS_URL_MARKER = 'tasks.google.com/task/';

function isGoogleTaskBackedEvent(note: string): boolean {
    const normalizedNote = note.trim().toLowerCase();
    return normalizedNote.includes(GOOGLE_TASKS_DESCRIPTION_MARKER)
        && normalizedNote.includes(GOOGLE_TASKS_URL_MARKER);
}

function stripGoogleTaskBoilerplate(note: string): string {
    return note
        .split('\n')
        .map(line => line.trim())
        .filter(line => {
            const normalizedLine = line.toLowerCase();
            return !(
                normalizedLine.includes(GOOGLE_TASKS_DESCRIPTION_MARKER)
                && normalizedLine.includes(GOOGLE_TASKS_URL_MARKER)
            );
        })
        .join('\n')
        .trim();
}

export interface GoogleCalendarNormalizedEvent {
    eventKey: string;
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    note: string;
}

export function buildTaskFromGoogleEvent(event: GoogleCalendarNormalizedEvent, taskId: number): CalendarTask {
    const isTask = isGoogleTaskBackedEvent(event.note);
    const normalizedNote = isTask ? stripGoogleTaskBoilerplate(event.note) : event.note;
    const deadline = isTask ? (event.endTime || event.startTime || '') : '';

    return {
        id: taskId,
        title: event.title,
        date: event.date,
        type: 'google',
        commitmentCategory: 'undetermined',
        itemKind: isTask ? 'task' : 'event',
        ddl: deadline,
        virtualDeadlineDate: event.date,
        virtualDeadlineTime: deadline,
        startTime: event.startTime,
        endTime: event.endTime,
        note: normalizedNote,
    };
}
