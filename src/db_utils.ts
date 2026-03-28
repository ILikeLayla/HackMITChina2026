import type { CalendarTask } from "./general_utils";
import {
    isValidHexColor,
    normalizeTaskCommitmentCategory,
} from "./general_utils";
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

export async function loadTaskTypeColorsFromTempDb(types: string[]): Promise<Record<string, string>> {
    const fallback = { ...defaultTypeColors };

    for (const type of types) {
        if (!fallback[type]) {
            fallback[type] = '#dfe7ff';
        }
    }

    try {
        const raw = await FileStorage.read<Record<string, string>>(TASK_TYPE_COLORS_DB_KEY);
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

export async function saveTaskTypeColorsToTempDb(typeColors: Record<string, string>): Promise<void> {
    try {
        await FileStorage.write(TASK_TYPE_COLORS_DB_KEY, typeColors);
    } catch (error) {
        console.error('[db_utils] Failed to save task type colors:', error);
    }
}

export async function loadTaskTypesFromTempDb(): Promise<string[]> {
    const seedTypes = ['other'];

    try {
        const raw = await FileStorage.read<string[]>(TASK_TYPES_DB_KEY);
        if (!raw || !Array.isArray(raw) || raw.length === 0) {
            return seedTypes;
        }
        return raw;
    } catch (error) {
        console.error('[db_utils] Failed to load task types:', error);
        return seedTypes;
    }
}

export async function loadTasksFromTempDb(): Promise<CalendarTask[]> {
    try {
        const raw = await FileStorage.read<Array<Partial<CalendarTask> & { time?: string }>>(TASKS_DB_KEY);
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
                const normalizedNote = String(task.note ?? '').toLowerCase();
                const isGoogleTaskByNote = String(task.type ?? '').toLowerCase() === 'google'
                    && normalizedNote.includes('changes made to the title, description, or attachments will not be saved')
                    && normalizedNote.includes('tasks.google.com/task/');
                const hasExplicitDdl = typeof task.ddl === 'string' && task.ddl.trim().length > 0;
                const hasExplicitEventTime =
                    (typeof task.startTime === 'string' && task.startTime.trim().length > 0)
                    || (typeof task.endTime === 'string' && task.endTime.trim().length > 0);
                const inferredKind = isGoogleTaskByNote
                    ? 'task'
                    : task.itemKind === 'event'
                    ? 'event'
                    : task.itemKind === 'task'
                        ? 'task'
                        : hasExplicitDdl
                            ? 'task'
                            : hasExplicitEventTime || legacyTime.includes('-')
                            ? 'event'
                            : 'task';

                const legacyRange = normalizeLegacyRange(legacyTime);

                return {
                    id: Number(task.id),
                    title: String(task.title ?? ''),
                    date: String(task.date ?? ''),
                    type: String(task.type ?? 'other'),
                    commitmentCategory: normalizeTaskCommitmentCategory(task.commitmentCategory) ?? 'undetermined',
                    itemKind: inferredKind,
                    ddl: inferredKind === 'task'
                        ? String(task.ddl ?? legacyTime)
                        : '',
                    virtualDeadlineDate: inferredKind === 'task'
                        ? String((task as any).virtualDeadlineDate ?? task.date ?? '')
                        : '',
                    virtualDeadlineTime: inferredKind === 'task'
                        ? String((task as any).virtualDeadlineTime ?? (task as any).virtualDeadline ?? task.ddl ?? legacyTime)
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

export async function saveTasksToTempDb(tasks: CalendarTask[]): Promise<void> {
    try {
        await FileStorage.write(TASKS_DB_KEY, tasks);
    } catch (error) {
        console.error('[db_utils] Failed to save tasks:', error);
    }
}

export async function saveTaskTypesToTempDb(types: string[]): Promise<void> {
    try {
        await FileStorage.write(TASK_TYPES_DB_KEY, types);
    } catch (error) {
        console.error('[db_utils] Failed to save task types:', error);
    }
}

export async function loadGoogleEventTaskMapFromTempDb(): Promise<Record<string, number>> {
    try {
        const raw = await FileStorage.read<Record<string, number>>(GOOGLE_EVENT_TASK_MAP_DB_KEY);
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

export async function saveGoogleEventTaskMapToTempDb(eventTaskMap: Record<string, number>): Promise<void> {
    try {
        await FileStorage.write(GOOGLE_EVENT_TASK_MAP_DB_KEY, eventTaskMap);
    } catch (error) {
        console.error('[db_utils] Failed to save Google event task map:', error);
    }
}
