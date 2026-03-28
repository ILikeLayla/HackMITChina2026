import type { CalendarTask } from "./general_utils";
import { isValidHexColor } from "./general_utils";
import { FileStorage } from "./file_storage";

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

    try {
        const raw = FileStorage.read<Record<string, string>>(TASK_TYPE_COLORS_DB_KEY);
        if (!raw) {
            return fallback;
        }

        const merged = { ...fallback };
        for (const type of Object.keys(raw)) {
            if (isValidHexColor(raw[type])) {
                merged[type] = raw[type];
            }
        }
        return merged;
    } catch (error) {
        console.error('[db_utils] Failed to load task type colors:', error);
        return fallback;
    }
}

export function saveTaskTypeColorsToTempDb(typeColors: Record<string, string>): void {
    try {
        FileStorage.write(TASK_TYPE_COLORS_DB_KEY, typeColors);
    } catch (error) {
        console.error('[db_utils] Failed to save task type colors:', error);
    }
}

export function loadTaskTypesFromTempDb(): string[] {
    const seedTypes = ['other'];

    try {
        const raw = FileStorage.read<string[]>(TASK_TYPES_DB_KEY);
        if (!raw || !Array.isArray(raw) || raw.length === 0) {
            return seedTypes;
        }
        return raw;
    } catch (error) {
        console.error('[db_utils] Failed to load task types:', error);
        return seedTypes;
    }
}

export function loadTasksFromTempDb(): CalendarTask[] {
    try {
        const raw = FileStorage.read<Array<Partial<CalendarTask> & { time?: string }>>(TASKS_DB_KEY);
        if (!raw || !Array.isArray(raw)) {
            return seedTasks;
        }

        const normalizeLegacyRange = (time?: string) => {
            if (!time || !time.includes('-')) {
                return { startTime: '', endTime: '' };
            }

            const [rawStart, rawEnd] = time.split('-');
            return {
                startTime: rawStart?.trim() ?? '',
                endTime: rawEnd?.trim() ?? '',
            };
        };

        return raw
            .filter(task => Number.isInteger(task.id))
            .map(task => {
                const legacyTime = typeof task.time === 'string' ? task.time : '';
                const inferredKind = task.itemKind === 'event'
                    ? 'event'
                    : task.itemKind === 'task'
                        ? 'task'
                        : task.type === 'google' || legacyTime.includes('-')
                            ? 'event'
                            : 'task';

                const legacyRange = normalizeLegacyRange(legacyTime);

                return {
                    id: Number(task.id),
                    title: String(task.title ?? ''),
                    date: String(task.date ?? ''),
                    type: String(task.type ?? 'other'),
                    itemKind: inferredKind,
                    ddl: inferredKind === 'task'
                        ? String(task.ddl ?? legacyTime)
                        : '',
                    startTime: inferredKind === 'event'
                        ? String(task.startTime ?? legacyRange.startTime)
                        : '',
                    endTime: inferredKind === 'event'
                        ? String(task.endTime ?? legacyRange.endTime)
                        : '',
                    note: String(task.note ?? ''),
                } satisfies CalendarTask;
            });
    } catch (error) {
        console.error('[db_utils] Failed to load tasks:', error);
        return seedTasks;
    }
}

export function saveTasksToTempDb(tasks: CalendarTask[]): void {
    try {
        FileStorage.write(TASKS_DB_KEY, tasks);
    } catch (error) {
        console.error('[db_utils] Failed to save tasks:', error);
    }
}

export function saveTaskTypesToTempDb(types: string[]): void {
    try {
        FileStorage.write(TASK_TYPES_DB_KEY, types);
    } catch (error) {
        console.error('[db_utils] Failed to save task types:', error);
    }
}

export function loadGoogleEventTaskMapFromTempDb(): Record<string, number> {
    try {
        const raw = FileStorage.read<Record<string, number>>(GOOGLE_EVENT_TASK_MAP_DB_KEY);
        if (!raw) {
            return {};
        }

        const normalized: Record<string, number> = {};
        for (const [eventKey, taskId] of Object.entries(raw)) {
            if (typeof eventKey === 'string' && Number.isInteger(taskId) && taskId > 0) {
                normalized[eventKey] = taskId;
            }
        }
        return normalized;
    } catch (error) {
        console.error('[db_utils] Failed to load Google event task map:', error);
        return {};
    }
}

export function saveGoogleEventTaskMapToTempDb(eventTaskMap: Record<string, number>): void {
    try {
        FileStorage.write(GOOGLE_EVENT_TASK_MAP_DB_KEY, eventTaskMap);
    } catch (error) {
        console.error('[db_utils] Failed to save Google event task map:', error);
    }
}
