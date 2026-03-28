export type TaskType = string;
export type CalendarItemKind = 'task' | 'event';
export type TaskCommitmentCategory = 'hard_commitment' | 'flexible_work' | 'undetermined';
export type DeadlineMode = 'actual' | 'virtual';

export type AiPreviewStatus = 'ai-preview-new' | 'ai-preview-modified' | 'ai-preview-deleted';

export interface CalendarTask {
    id: number;
    title: string;
    date: string;
    type: TaskType;
    commitmentCategory?: TaskCommitmentCategory;
    itemKind: CalendarItemKind;
    ddl: string;
    virtualDeadlineDate: string;
    virtualDeadlineTime: string;
    startTime: string;
    endTime: string;
    note: string;
    _aiPreviewStatus?: AiPreviewStatus;
}

export function normalizeTaskCommitmentCategory(value: unknown): TaskCommitmentCategory | null {
    if (value === 'hard_commitment' || value === 'flexible_work' || value === 'undetermined') {
        return value;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normalized === 'hard_commitment' || normalized === 'hard_commitments') {
        return 'hard_commitment';
    }
    if (normalized === 'flexible_work' || normalized === 'flexible_works') {
        return 'flexible_work';
    }
    if (normalized === 'undetermined') {
        return 'undetermined';
    }
    return null;
}

export function getDefaultCommitmentCategoryForItemKind(_itemKind: CalendarItemKind): TaskCommitmentCategory {
    return 'undetermined';
}

export function getTaskCommitmentCategory(task: CalendarTask): TaskCommitmentCategory {
    return normalizeTaskCommitmentCategory(task.commitmentCategory) ?? 'undetermined';
}

export function getTaskCommitmentCategoryLabel(category: TaskCommitmentCategory): string {
    if (category === 'hard_commitment') return 'Hard commitment';
    if (category === 'flexible_work') return 'Flexible work';
    return '';
}

export interface CalendarDay {
    day: number;
    month: number;
    year: number;
    isOtherMonth?: boolean;
    isToday?: boolean;
}

export function parseTaskDate(dateStr: string) {
    return new Date(`${dateStr}T00:00:00`);
}

export function getTaskDisplayDate(task: CalendarTask, mode: DeadlineMode = 'actual') {
    if (task.itemKind === 'event') {
        return task.date;
    }
    if (mode === 'actual') {
        return task.date;
    }
    return task.virtualDeadlineDate || task.date;
}

export function getTaskSortTime(task: CalendarTask, mode: DeadlineMode = 'actual') {
    if (task.itemKind === 'event') {
        return task.startTime;
    }
    return mode === 'actual' ? task.ddl : task.virtualDeadlineTime;
}

export function getTaskDisplayTime(task: CalendarTask, mode: DeadlineMode = 'actual') {
    if (task.itemKind === 'event') {
        const start = task.startTime || '--:--';
        const end = task.endTime || '--:--';
        return `${start} - ${end}`;
    }
    const deadline = mode === 'actual' ? task.ddl : task.virtualDeadlineTime;
    const prefix = mode === 'actual' ? 'DDL' : 'VDDL';
    return `${prefix} ${deadline || '--:--'}`;
}

export function getTaskDeadline(task: CalendarTask, mode: DeadlineMode = 'actual') {
    if (task.itemKind === 'event') {
        return task.startTime;
    }
    return mode === 'actual' ? task.ddl : task.virtualDeadlineTime;
}

export function isValidHexColor(value: string) {
    return /^#[0-9A-Fa-f]{6}$/.test(value);
}

export function getReadableTextColor(hexColor: string) {
    const color = hexColor.replace('#', '');
    const red = parseInt(color.substring(0, 2), 16);
    const green = parseInt(color.substring(2, 4), 16);
    const blue = parseInt(color.substring(4, 6), 16);
    const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
    return brightness > 160 ? '#1d1d1d' : '#ffffff';
}

export function generateCalendarDays(currentDate: Date) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const days: CalendarDay[] = [];

    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
        days.push({
            day: prevMonthDays - i,
            month: month - 1,
            year,
            isOtherMonth: true,
        });
    }

    const now = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
        days.push({
            day: i,
            month,
            year,
            isOtherMonth: false,
            isToday: i === now.getDate() && month === now.getMonth() && year === now.getFullYear(),
        });
    }

    // const remainingDays = 42 - days.length;
    const remainingDays = (7 - (days.length % 7)) % 7; // Ensure we only add the necessary days to complete the last week

    for (let i = 1; i <= remainingDays; i++) {
        days.push({
            day: i,
            month: month + 1,
            year,
            isOtherMonth: true,
        });
    }

    return days;
}

export function generateWeekDays(currentDate: Date) {
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());

    const now = new Date();
    const weekDays: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);
        weekDays.push({
            day: date.getDate(),
            month: date.getMonth(),
            year: date.getFullYear(),
            isToday:
                date.getDate() === now.getDate() &&
                date.getMonth() === now.getMonth() &&
                date.getFullYear() === now.getFullYear(),
        });
    }

    return weekDays;
}

export function getWeekTitle(currentDate: Date) {
    const start = new Date(currentDate);
    start.setDate(currentDate.getDate() - currentDate.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const startLabel = start.toLocaleDateString('default', { month: 'short', day: 'numeric' });
    const endLabel = end.toLocaleDateString('default', { month: 'short', day: 'numeric' });

    return `${startLabel} - ${endLabel}, ${end.getFullYear()}`;
}

export function getDayTitle(currentDate: Date) {
    return currentDate.toLocaleDateString('default', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

export function getFirstUpcomingTaskKey(listTaskGroups: [string, CalendarTask[]][]) {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return listTaskGroups.find(([key]) => {
        const [year, month, day] = key.split('-').map(Number);
        return new Date(year, month, day).getTime() >= todayStart;
    })?.[0] ?? listTaskGroups[0]?.[0];
}
