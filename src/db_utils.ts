import type { CalendarTask } from "./general_utils";
import { isValidHexColor } from "./general_utils";

export const TASKS_DB_KEY = 'mvp-calendar-tasks';
export const TASK_TYPES_DB_KEY = 'mvp-calendar-task-types';
export const TASK_TYPE_COLORS_DB_KEY = 'mvp-calendar-task-type-colors';

export const seedTasks: CalendarTask[] = [
    { id: 1, title: 'Conference', date: '2026-03-01', type: 'work', time: '09:00', note: 'Main hall presentation.' },
    { id: 2, title: 'All Day Event', date: '2026-03-01', type: 'personal', time: '10:00', note: 'Family activity day.' },
    { id: 3, title: '10:30a Meeting', date: '2026-03-01', type: 'work', time: '10:30', note: 'Discuss project scope.' },
    { id: 4, title: '12p Lunch', date: '2026-03-01', type: 'personal', time: '12:00', note: 'Lunch with friends.' },
    { id: 5, title: '7th Birthday Party', date: '2026-03-03', type: 'personal', time: '18:30', note: 'Bring gifts and cake.' },
    { id: 6, title: 'Long Event', date: '2026-03-07', type: 'work', time: '09:30', note: 'All-day workshop block A.' },
    { id: 7, title: 'Long Event', date: '2026-03-08', type: 'work', time: '09:30', note: 'All-day workshop block B.' },
    { id: 8, title: '4p Repeating Event', date: '2026-03-08', type: 'work', time: '16:00', note: 'Weekly sync meeting.' },
    { id: 9, title: '4p Repeating Event', date: '2026-03-15', type: 'work', time: '16:00', note: 'Weekly sync meeting.' },
    { id: 10, title: 'Click for Google', date: '2026-03-27', type: 'important', time: '11:00', note: 'Prepare link + checklist.' },
];

export const defaultTypeColors: Record<string, string> = {
    other: '#b8b8b8',
};

export function loadTaskTypeColorsFromTempDb(types: string[]): Record<string, string> {
    const fallback = { ...defaultTypeColors };

    for (const type of types) {
        if (!fallback[type]) {
            fallback[type] = '#dfe7ff';
        }
    }

    if (typeof window === 'undefined') {
        return fallback;
    }

    const raw = window.localStorage.getItem(TASK_TYPE_COLORS_DB_KEY);
    if (!raw) {
        return fallback;
    }

    try {
        const parsed = JSON.parse(raw) as Record<string, string>;
        const merged = { ...fallback };
        for (const type of Object.keys(parsed)) {
            if (isValidHexColor(parsed[type])) {
                merged[type] = parsed[type];
            }
        }
        return merged;
    } catch {
        return fallback;
    }
}

export function saveTaskTypeColorsToTempDb(typeColors: Record<string, string>) {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(TASK_TYPE_COLORS_DB_KEY, JSON.stringify(typeColors));
}

export function loadTaskTypesFromTempDb(): string[] {
    const seedTypes = ['other'];

    if (typeof window === 'undefined') {
        return seedTypes;
    }

    const raw = window.localStorage.getItem(TASK_TYPES_DB_KEY);
    if (!raw) {
        return seedTypes;
    }

    try {
        const parsed = JSON.parse(raw) as string[];
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return seedTypes;
        }
        return parsed;
    } catch {
        return seedTypes;
    }
}

export function loadTasksFromTempDb(): CalendarTask[] {
    if (typeof window === 'undefined') {
        return seedTasks;
    }

    const raw = window.localStorage.getItem(TASKS_DB_KEY);
    if (!raw) {
        return seedTasks;
    }

    try {
        const parsed = JSON.parse(raw) as CalendarTask[];
        if (!Array.isArray(parsed)) {
            return seedTasks;
        }
        return parsed;
    } catch {
        return seedTasks;
    }
}

export function saveTasksToTempDb(tasks: CalendarTask[]) {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(TASKS_DB_KEY, JSON.stringify(tasks));
}

export function saveTaskTypesToTempDb(types: string[]) {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(TASK_TYPES_DB_KEY, JSON.stringify(types));
}
