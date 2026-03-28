import { getTaskSortTime, parseTaskDate, type CalendarDay, type CalendarTask } from "./general_utils";

export const ADD_TYPE_OPTION_VALUE = '__add_new_type__';
export const OTHER_TYPE = 'other';
export const DATE_SWITCH_ANIMATION_MS = 280;
export const VIEW_SWITCH_ANIMATION_MS = 240;
export const FILTER_BUTTON_HORIZONTAL_PADDING_PX = 20;
export const FILTER_BUTTON_BORDER_PX = 2;

export type ViewMode = 'month' | 'week' | 'day' | 'list';
export type DateTransitionDirection = 'forward' | 'backward';
export type SearchScope = 'all' | 'title' | 'note' | 'time' | 'type';

export interface DateTransitionState {
    direction: DateTransitionDirection;
    nextDate: Date;
}

export interface ViewTransitionState {
    fromMode: ViewMode;
    toMode: ViewMode;
    direction: DateTransitionDirection;
}

export const VIEW_ORDER: ViewMode[] = ['month', 'week', 'day', 'list'];

export function isSameDay(left: Date, right: Date) {
    return (
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate()
    );
}

export function buildShiftedDate(baseDate: Date, direction: -1 | 1, viewMode: ViewMode) {
    const nextDate = new Date(baseDate);
    if (viewMode === 'week') {
        nextDate.setDate(nextDate.getDate() + direction * 7);
    } else if (viewMode === 'day') {
        nextDate.setDate(nextDate.getDate() + direction);
    } else {
        nextDate.setMonth(nextDate.getMonth() + direction);
    }
    return nextDate;
}

export function filterAndSortTasks(
    tasks: CalendarTask[],
    filterType: string,
    filterKeyword: string,
    searchScope: SearchScope,
) {
    const normalizedKeyword = filterKeyword.trim().toLowerCase();

    return [...tasks]
        .filter(task => {
            if (filterType !== 'all' && task.type !== filterType) {
                return false;
            }

            if (!normalizedKeyword) {
                return true;
            }

            if (searchScope === 'title') {
                return task.title.toLowerCase().includes(normalizedKeyword);
            }

            if (searchScope === 'note') {
                return task.note.toLowerCase().includes(normalizedKeyword);
            }

            if (searchScope === 'time') {
                const timeText = task.itemKind === 'event'
                    ? `${task.startTime} ${task.endTime}`
                    : task.ddl;
                return timeText.toLowerCase().includes(normalizedKeyword);
            }

            if (searchScope === 'type') {
                return task.type.toLowerCase().includes(normalizedKeyword);
            }

            const keywordPool = `${task.title} ${task.note} ${task.ddl} ${task.startTime} ${task.endTime} ${task.type} ${task.itemKind}`.toLowerCase();
            return keywordPool.includes(normalizedKeyword);
        })
        .sort((a, b) => {
            const dateA = parseTaskDate(a.date).getTime();
            const dateB = parseTaskDate(b.date).getTime();
            return dateA - dateB || getTaskSortTime(a).localeCompare(getTaskSortTime(b));
        });
}

export function getTasksForDayFromTasks(tasks: CalendarTask[], day: CalendarDay) {
    return tasks.filter(task => {
        const taskDate = parseTaskDate(task.date);
        return (
            taskDate.getDate() === day.day &&
            taskDate.getMonth() === day.month &&
            taskDate.getFullYear() === day.year
        );
    });
}

export function groupTasksByDate(tasks: CalendarTask[]) {
    return Object.entries(
        tasks.reduce((acc: Record<string, CalendarTask[]>, task) => {
            const taskDate = parseTaskDate(task.date);
            const key = `${taskDate.getFullYear()}-${taskDate.getMonth()}-${taskDate.getDate()}`;
            if (!acc[key]) {
                acc[key] = [];
            }
            acc[key].push(task);
            return acc;
        }, {}),
    ).sort((a, b) => {
        const [ay, am, ad] = a[0].split('-').map(Number);
        const [by, bm, bd] = b[0].split('-').map(Number);
        return new Date(ay, am, ad).getTime() - new Date(by, bm, bd).getTime();
    });
}

export function buildDateString(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
