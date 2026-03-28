import type { CalendarTask } from "./general_utils";
import { isValidHexColor } from "./general_utils";

export const TASKS_DB_KEY = 'mvp-calendar-tasks';
export const TASK_TYPES_DB_KEY = 'mvp-calendar-task-types';
export const TASK_TYPE_COLORS_DB_KEY = 'mvp-calendar-task-type-colors';
export const GOOGLE_EVENT_TASK_MAP_DB_KEY = 'mvp-calendar-google-event-task-map';

export const seedTasks: CalendarTask[] = [
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

export function loadGoogleEventTaskMapFromTempDb(): Record<string, number> {
    if (typeof window === 'undefined') {
        return {};
    }

    const raw = window.localStorage.getItem(GOOGLE_EVENT_TASK_MAP_DB_KEY);
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw) as Record<string, number>;
        const normalized: Record<string, number> = {};
        for (const [eventKey, taskId] of Object.entries(parsed)) {
            if (typeof eventKey === 'string' && Number.isInteger(taskId) && taskId > 0) {
                normalized[eventKey] = taskId;
            }
        }
        return normalized;
    } catch {
        return {};
    }
}

export function saveGoogleEventTaskMapToTempDb(eventTaskMap: Record<string, number>) {
    if (typeof window === 'undefined') {
        return;
    }

    window.localStorage.setItem(GOOGLE_EVENT_TASK_MAP_DB_KEY, JSON.stringify(eventTaskMap));
}
