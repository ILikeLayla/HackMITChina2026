import { useEffect, useRef, useState } from "react";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";
import {
    defaultTypeColors,
    loadTaskTypeColorsFromTempDb,
    loadTasksFromTempDb,
    loadTaskTypesFromTempDb,
    saveTaskTypeColorsToTempDb,
    saveTasksToTempDb,
    saveTaskTypesToTempDb,
} from "./db_utils";
import {
    generateDayViewDOM,
    generateListViewDOM,
    generateMonthViewDOM,
    generateWeekViewDOM,
} from "./dom_generation";
import {
    ADD_TYPE_OPTION_VALUE,
    OTHER_TYPE,
    DATE_SWITCH_ANIMATION_MS,
    VIEW_SWITCH_ANIMATION_MS,
    FILTER_BUTTON_HORIZONTAL_PADDING_PX,
    FILTER_BUTTON_BORDER_PX,
    VIEW_ORDER,
    type ViewMode,
    type DateTransitionDirection,
    type DateTransitionState,
    type ViewTransitionState,
    type SearchScope,
    isSameDay,
    buildShiftedDate,
    filterAndSortTasks,
    getTasksForDayFromTasks,
    groupTasksByDate,
    buildDateString,
} from "./calendar_logic";
import {
    generateCalendarDays,
    generateWeekDays,
    getDayTitle,
    getReadableTextColor,
    getWeekTitle,
    isValidHexColor,
    parseTaskDate,
    type CalendarDay,
    type CalendarTask,
    type TaskType,
} from "./general_utils";

async function get_events() {
    console.log(await invoke('get_events'));
}

const MODAL_CLOSE_ANIMATION_MS = 180;
const FILTER_REFRESH_ANIMATION_MS = 180;

function MainCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<ViewMode>('month');
    const [dateTransition, setDateTransition] = useState<DateTransitionState | null>(null);
    const [viewTransition, setViewTransition] = useState<ViewTransitionState | null>(null);
    const [tasks, setTasks] = useState<CalendarTask[]>(() => loadTasksFromTempDb());
    const [taskTypes, setTaskTypes] = useState<string[]>(() => loadTaskTypesFromTempDb());
    const [taskTypeColors, setTaskTypeColors] = useState<Record<string, string>>(() => loadTaskTypeColorsFromTempDb(loadTaskTypesFromTempDb()));
    const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
    const [isCreatingTask, setIsCreatingTask] = useState(false);
    const [creatingTaskDate, setCreatingTaskDate] = useState(new Date());
    const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);
    const [isTaskModalClosing, setIsTaskModalClosing] = useState(false);
    const [isTypeModalClosing, setIsTypeModalClosing] = useState(false);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [aiTaskDescription, setAiTaskDescription] = useState('');
    const [aiReplyText, setAiReplyText] = useState('');
    const [typeModalMode, setTypeModalMode] = useState<'create' | 'edit'>('create');
    const [typeEditingOriginalName, setTypeEditingOriginalName] = useState<string | null>(null);
    const [typeDraftName, setTypeDraftName] = useState('');
    const [typeDraftColor, setTypeDraftColor] = useState('#4f7ef7');
    const [filterType, setFilterType] = useState<string>('all');
    const [filterKeyword, setFilterKeyword] = useState('');
    const [searchScope, setSearchScope] = useState<SearchScope>('all');
    const [isHeaderToolsOpen, setIsHeaderToolsOpen] = useState(false);
    const [isFilterRefreshActive, setIsFilterRefreshActive] = useState(false);
    const [filtersButtonWidth, setFiltersButtonWidth] = useState<number | null>(null);
    const [modalDraft, setModalDraft] = useState<Omit<CalendarTask, 'id' | 'date'> | null>(null);
    const listScrollTargetRef = useRef<HTMLDivElement | null>(null);
    const dateTransitionTimerRef = useRef<number | null>(null);
    const viewTransitionTimerRef = useRef<number | null>(null);
    const taskModalCloseTimerRef = useRef<number | null>(null);
    const typeModalCloseTimerRef = useRef<number | null>(null);
    const filterRefreshTimerRef = useRef<number | null>(null);
    const filterRefreshRafRef = useRef<number | null>(null);
    const hasMountedFilterControlsRef = useRef(false);
    const filtersButtonMeasureRef = useRef<HTMLSpanElement | null>(null);

    const selectedTask = tasks.find(task => task.id === selectedTaskId) ?? null;
    const nextTaskId = tasks.reduce((maxId, task) => Math.max(maxId, task.id), 0) + 1;

    const ws = useRef<WebSocket | null>(null);
    const taskCreationResult = useRef<string| null>(null);
    useEffect(() => {
        ws.current = new WebSocket('ws://localhost:8765');

        const handleMessage = (event: MessageEvent) => {
            console.log('Received message from WebSocket:', event.data);
            // start with "newing_task: " followed by a date string in json format
            if (typeof event.data === 'string' && event.data.startsWith('newing_task: ')) {
                console.log('Handling newing_task message');
                const task_info = JSON.parse(event.data.substring('newing_task: '.length));
                const date = task_info.date ? new Date(task_info.date) : new Date();
                const title = task_info.title || '';
                // check if type is valid, otherwise create a new type with random color
                let type = task_info.type || OTHER_TYPE;
                if (type !== OTHER_TYPE && !taskTypes.includes(type)) {
                    type = type.trim().toLowerCase();
                    if (!type) {
                        type = OTHER_TYPE;
                    } else {
                        setTaskTypes(prev => [...prev, type]);
                        setTaskTypeColors(prev => ({
                            ...prev,
                            [type]: task_info.color && isValidHexColor(task_info.color) ? task_info.color : `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
                        }));
                    }
                }
                const time = task_info.time || '';
                const note = task_info.note || '';
                const newTask: CalendarTask = {
                    id: nextTaskId,
                    title,
                    type,
                    time,
                    note,
                    date: buildDateString(date),
                };
                setTasks(prev => [...prev, newTask]);
                console.log('Created new task from WebSocket message:', newTask);
                // wait for 5 seconds
                setTimeout(() => {
                    ws.current?.send(`created_task: ${JSON.stringify(newTask)}`);
                }, 5000);
            }

            if (typeof event.data === 'string' && event.data.startsWith('task_creation_result: ')) {
                console.log('Handling task_creation_result message');
                taskCreationResult.current = event.data.substring('task_creation_result: '.length);
            }

        };
        ws.current?.addEventListener('message', handleMessage);

        return () => {
            ws.current?.removeEventListener('message', handleMessage);
            ws.current?.close();
        };
    }, [taskTypes, nextTaskId]);

    const cancelDateTransition = () => {
        if (dateTransitionTimerRef.current !== null) {
            window.clearTimeout(dateTransitionTimerRef.current);
            dateTransitionTimerRef.current = null;
        }

        setDateTransition(null);
    };

    const cancelViewTransition = () => {
        if (viewTransitionTimerRef.current !== null) {
            window.clearTimeout(viewTransitionTimerRef.current);
            viewTransitionTimerRef.current = null;
        }

        setViewTransition(null);
    };

    const clearTaskModalCloseTimer = () => {
        if (taskModalCloseTimerRef.current !== null) {
            window.clearTimeout(taskModalCloseTimerRef.current);
            taskModalCloseTimerRef.current = null;
        }
    };

    const clearTypeModalCloseTimer = () => {
        if (typeModalCloseTimerRef.current !== null) {
            window.clearTimeout(typeModalCloseTimerRef.current);
            typeModalCloseTimerRef.current = null;
        }
    };

    const clearFilterRefreshAnimation = () => {
        if (filterRefreshTimerRef.current !== null) {
            window.clearTimeout(filterRefreshTimerRef.current);
            filterRefreshTimerRef.current = null;
        }

        if (filterRefreshRafRef.current !== null) {
            window.cancelAnimationFrame(filterRefreshRafRef.current);
            filterRefreshRafRef.current = null;
        }
    };

    const startDateTransition = (targetDate: Date, direction: DateTransitionDirection) => {
        if (viewMode === 'list') {
            setCurrentDate(new Date(targetDate));
            return;
        }

        cancelDateTransition();
        const frozenTargetDate = new Date(targetDate);
        setDateTransition({
            direction,
            nextDate: frozenTargetDate,
        });
        dateTransitionTimerRef.current = window.setTimeout(() => {
            setCurrentDate(frozenTargetDate);
            setDateTransition(null);
            dateTransitionTimerRef.current = null;
        }, DATE_SWITCH_ANIMATION_MS);
    };

    const handlePrevMonth = () => {
        if (dateTransition || viewTransition) {
            return;
        }
        const newDate = buildShiftedDate(currentDate, -1, viewMode);
        startDateTransition(newDate, 'backward');
    };

    const handleNextMonth = () => {
        if (dateTransition || viewTransition) {
            return;
        }
        const newDate = buildShiftedDate(currentDate, 1, viewMode);
        startDateTransition(newDate, 'forward');
    };

    const handleToday = () => {
        if (viewMode === 'list') {
            requestAnimationFrame(() => {
                const target = listScrollTargetRef.current;
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
            return;
        }

        if (dateTransition || viewTransition) {
            return;
        }

        const targetDate = new Date();
        if (isSameDay(currentDate, targetDate)) {
            return;
        }

        const direction: DateTransitionDirection = targetDate.getTime() >= currentDate.getTime() ? 'forward' : 'backward';
        startDateTransition(targetDate, direction);
    };

    const handleViewChange = (mode: ViewMode) => {
        if (mode === viewMode || viewTransition) {
            return;
        }

        const currentIndex = VIEW_ORDER.indexOf(viewMode);
        const nextIndex = VIEW_ORDER.indexOf(mode);
        const direction: DateTransitionDirection = nextIndex >= currentIndex ? 'forward' : 'backward';

        cancelDateTransition();
        cancelViewTransition();
        setViewTransition({
            fromMode: viewMode,
            toMode: mode,
            direction,
        });

        viewTransitionTimerRef.current = window.setTimeout(() => {
            setViewMode(mode);
            setViewTransition(null);
            viewTransitionTimerRef.current = null;
        }, VIEW_SWITCH_ANIMATION_MS);
    };

    useEffect(() => {
        void get_events();
    }, []);

    useEffect(() => {
        return () => {
            if (dateTransitionTimerRef.current !== null) {
                window.clearTimeout(dateTransitionTimerRef.current);
            }

            cancelViewTransition();
            clearTaskModalCloseTimer();
            clearTypeModalCloseTimer();
            clearFilterRefreshAnimation();
        };
    }, []);

    useEffect(() => {
        cancelDateTransition();
    }, [viewMode]);

    useEffect(() => {
        saveTasksToTempDb(tasks);
    }, [tasks]);

    useEffect(() => {
        saveTaskTypesToTempDb(taskTypes);
    }, [taskTypes]);

    useEffect(() => {
        saveTaskTypeColorsToTempDb(taskTypeColors);
    }, [taskTypeColors]);

    useEffect(() => {
        if (!filtersButtonMeasureRef.current) {
            return;
        }

        const textWidth = Math.ceil(filtersButtonMeasureRef.current.getBoundingClientRect().width);
        setFiltersButtonWidth(textWidth + FILTER_BUTTON_HORIZONTAL_PADDING_PX + FILTER_BUTTON_BORDER_PX);
    }, [isHeaderToolsOpen]);

    useEffect(() => {
        if (!hasMountedFilterControlsRef.current) {
            hasMountedFilterControlsRef.current = true;
            return;
        }

        clearFilterRefreshAnimation();
        setIsFilterRefreshActive(false);

        filterRefreshRafRef.current = window.requestAnimationFrame(() => {
            setIsFilterRefreshActive(true);
            filterRefreshTimerRef.current = window.setTimeout(() => {
                setIsFilterRefreshActive(false);
                filterRefreshTimerRef.current = null;
            }, FILTER_REFRESH_ANIMATION_MS);
            filterRefreshRafRef.current = null;
        });
    }, [filterType, filterKeyword, searchScope]);

    const renderViewContent = (mode: ViewMode, displayDate: Date) => {
        if (mode === 'list') {
            return generateListViewDOM({
                listTaskGroups,
                listScrollTargetRef,
                getTaskStyle,
                openTaskModal,
            });
        }

        if (mode === 'day') {
            return generateDayViewDOM({
                currentDate: displayDate,
                getTasksForDay,
                getTaskStyle,
                openTaskModal,
            });
        }

        if (mode === 'week') {
            return generateWeekViewDOM({
                weekDays: generateWeekDays(displayDate),
                getTasksForDay,
                getTaskStyle,
                openTaskModal,
                handleDayClick,
            });
        }

        return generateMonthViewDOM({
            calendarDays: generateCalendarDays(displayDate),
            getTasksForDay,
            getTaskStyle,
            openTaskModal,
            handleDayClick,
        });
    };

    const filteredAndSortedTasks = filterAndSortTasks(tasks, filterType, filterKeyword, searchScope);

    const getTasksForDay = (day: CalendarDay) => {
        return getTasksForDayFromTasks(filteredAndSortedTasks, day);
    };

    const listTaskGroups = groupTasksByDate(filteredAndSortedTasks);

    useEffect(() => {
        if (viewMode !== 'list') {
            return;
        }

        const target = listScrollTargetRef.current;
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [viewMode]);

    useEffect(() => {
        const selectors = '.days, .day-view-tasks';
        const scrollElements = Array.from(document.querySelectorAll<HTMLElement>(selectors));
        if (scrollElements.length === 0) {
            return;
        }

        const cleanups: Array<() => void> = [];

        scrollElements.forEach((element) => {
            const isDayViewTasks = element.classList.contains('day-view-tasks');
            const indicatorHost = isDayViewTasks
                ? element.closest<HTMLElement>('.day-view')
                : element.parentElement;
            if (!indicatorHost) {
                return;
            }

            const updateIndicator = () => {
                const maxScroll = element.scrollHeight - element.clientHeight;
                let trackTopPx = 4;
                let trackBottomPx = 4;

                if (isDayViewTasks) {
                    const hostRect = indicatorHost.getBoundingClientRect();
                    const elementRect = element.getBoundingClientRect();
                    const dayTasksTop = elementRect.top - hostRect.top;
                    const dayTasksBottom = dayTasksTop + element.clientHeight;
                    trackTopPx = dayTasksTop + 4;
                    trackBottomPx = Math.max(4, indicatorHost.clientHeight - dayTasksBottom + 4);
                }

                const trackLength = Math.max(0, indicatorHost.clientHeight - trackTopPx - trackBottomPx);
                indicatorHost.style.setProperty('--scroll-indicator-track-top', `${trackTopPx}px`);
                indicatorHost.style.setProperty('--scroll-indicator-track-bottom', `${trackBottomPx}px`);

                if (maxScroll <= 1 || trackLength <= 0) {
                    indicatorHost.style.setProperty('--scroll-indicator-opacity', '0');
                    indicatorHost.style.setProperty('--scroll-indicator-size', '0px');
                    indicatorHost.style.setProperty('--scroll-indicator-offset', `${trackTopPx}px`);
                    return;
                }

                const minThumbSize = 22;
                const rawThumbSize = (element.clientHeight / element.scrollHeight) * trackLength;
                const thumbSize = Math.min(trackLength, Math.max(minThumbSize, rawThumbSize));
                const maxThumbTravel = Math.max(0, trackLength - thumbSize);
                const clampedScrollTop = Math.min(maxScroll, Math.max(0, element.scrollTop));
                const scrollProgress = maxScroll > 0 ? clampedScrollTop / maxScroll : 0;
                const clampedProgress = Math.min(1, Math.max(0, scrollProgress));
                const thumbTravel = Math.min(maxThumbTravel, Math.max(0, maxThumbTravel * clampedProgress));
                const thumbOffset = trackTopPx + thumbTravel;

                indicatorHost.style.setProperty('--scroll-indicator-opacity', '1');
                indicatorHost.style.setProperty('--scroll-indicator-size', `${thumbSize}px`);
                indicatorHost.style.setProperty('--scroll-indicator-offset', `${thumbOffset}px`);
            };

            const handleScroll = () => {
                updateIndicator();
            };

            indicatorHost.classList.add('has-custom-scroll-indicator');
            element.addEventListener('scroll', handleScroll, { passive: true });

            const resizeObserver = new ResizeObserver(() => {
                updateIndicator();
            });
            resizeObserver.observe(element);
            resizeObserver.observe(indicatorHost);

            updateIndicator();

            cleanups.push(() => {
                element.removeEventListener('scroll', handleScroll);
                resizeObserver.disconnect();
                indicatorHost.classList.remove('has-custom-scroll-indicator');
                indicatorHost.style.removeProperty('--scroll-indicator-opacity');
                indicatorHost.style.removeProperty('--scroll-indicator-size');
                indicatorHost.style.removeProperty('--scroll-indicator-offset');
                indicatorHost.style.removeProperty('--scroll-indicator-track-top');
                indicatorHost.style.removeProperty('--scroll-indicator-track-bottom');
            });
        });

        return () => {
            cleanups.forEach(cleanup => cleanup());
        };
    }, [viewMode, dateTransition, viewTransition, tasks, filterType, filterKeyword, searchScope]);

    const openTaskModal = (task: CalendarTask) => {
        clearTaskModalCloseTimer();
        setIsTaskModalClosing(false);
        setIsCreatingTask(false);
        setSelectedTaskId(task.id);
        setModalDraft({
            title: task.title,
            type: task.type,
            time: task.time,
            note: task.note,
        });
    };

    const openCreateTaskModal = (date: Date) => {
        clearTaskModalCloseTimer();
        setIsTaskModalClosing(false);
        const defaultType = taskTypes[0] ?? 'work';
        setIsCreatingTask(true);
        setSelectedTaskId(null);
        console.log('Creating task for date:', date);
        setCreatingTaskDate(date);
        setModalDraft({
            title: '',
            type: defaultType,
            time: '09:00',
            note: '',
        });
    };

    const resetTypeModalState = () => {
        setTypeModalMode('create');
        setTypeEditingOriginalName(null);
        setTypeDraftName('');
        setTypeDraftColor('#4f7ef7');
    };

    const closeTypeModal = () => {
        if (!isTypeModalOpen || isTypeModalClosing) {
            return;
        }

        setIsTypeModalClosing(true);
        clearTypeModalCloseTimer();
        typeModalCloseTimerRef.current = window.setTimeout(() => {
            setIsTypeModalOpen(false);
            setIsTypeModalClosing(false);
            resetTypeModalState();
            typeModalCloseTimerRef.current = null;
        }, MODAL_CLOSE_ANIMATION_MS);
    };

    const closeTaskModal = () => {
        if (!modalDraft || isTaskModalClosing) {
            return;
        }

        if (isTypeModalOpen) {
            closeTypeModal();
        }

        setIsTaskModalClosing(true);
        clearTaskModalCloseTimer();
        taskModalCloseTimerRef.current = window.setTimeout(() => {
            clearTypeModalCloseTimer();
            setSelectedTaskId(null);
            setIsCreatingTask(false);
            setModalDraft(null);
            setIsTaskModalClosing(false);
            setIsTypeModalOpen(false);
            setIsTypeModalClosing(false);
            resetTypeModalState();
            taskModalCloseTimerRef.current = null;
        }, MODAL_CLOSE_ANIMATION_MS);
    };

    const openAiCreateModal = () => {
        setIsAiModalOpen(true);
        setAiTaskDescription('');
        setAiReplyText('');
    };

    const closeAiCreateModal = () => {
        setIsAiModalOpen(false);
    };

    const handleAiTaskDescriptionChange = (value: string) => {
        setAiTaskDescription(value);
    };

    const handleCreateWithAi = () => {
        // TODO: wire your AI request callback here.
        // Expected flow:
        // 1) Send `aiTaskDescription` to your AI service.
        // 2) Update `aiReplyText` with the response text.
        // 3) Optionally parse returned data and create calendar tasks.
        console.log('AI Task Description:', aiTaskDescription);
        ws.current?.send(`ai_task_description: ${aiTaskDescription}`);
        // wait for the taskCreationResult to be set by the WebSocket message handler, then update the aiReplyText with the result
        const checkForAiResult = () => {
            if (taskCreationResult.current !== null) {
                setAiReplyText(taskCreationResult.current);
                taskCreationResult.current = null;
            } else {
                setTimeout(checkForAiResult, 500);
            }
        };
        checkForAiResult();
    };

    const openTypeCreateModal = () => {
        clearTypeModalCloseTimer();
        setIsTypeModalClosing(false);
        setTypeModalMode('create');
        setTypeEditingOriginalName(null);
        setTypeDraftName('');
        setTypeDraftColor('#4f7ef7');
        setIsTypeModalOpen(true);
    };

    const openTypeEditModal = () => {
        if (!modalDraft?.type) {
            return;
        }

        clearTypeModalCloseTimer();
        setIsTypeModalClosing(false);
        const currentType = modalDraft.type;
        setTypeModalMode('edit');
        setTypeEditingOriginalName(currentType);
        setTypeDraftName(currentType);
        setTypeDraftColor(taskTypeColors[currentType] ?? '#dfe7ff');
        setIsTypeModalOpen(true);
    };

    const addTaskTypeWithColor = () => {
        const normalized = typeDraftName.trim().toLowerCase();
        if (!normalized || !isValidHexColor(typeDraftColor)) {
            return;
        }

        if (typeModalMode === 'edit' && typeEditingOriginalName) {
            const original = typeEditingOriginalName;
            if (normalized !== original && taskTypes.includes(normalized)) {
                return;
            }

            setTaskTypes(prev => prev.map(type => type === original ? normalized : type));
            setTaskTypeColors(prev => {
                const next = { ...prev };
                delete next[original];
                next[normalized] = typeDraftColor;
                return next;
            });
            setTasks(prev => prev.map(task => (
                task.type === original
                    ? { ...task, type: normalized }
                    : task
            )));

            if (modalDraft) {
                setModalDraft(prev => prev ? { ...prev, type: normalized } : prev);
            }

            if (filterType === original) {
                setFilterType(normalized);
            }

            closeTypeModal();
            return;
        }

        if (!taskTypes.includes(normalized)) {
            setTaskTypes(prev => [...prev, normalized]);
        }

        setTaskTypeColors(prev => ({
            ...prev,
            [normalized]: typeDraftColor,
        }));

        if (modalDraft) {
            setModalDraft(prev => prev ? { ...prev, type: normalized } : prev);
        }

        closeTypeModal();
    };

    const deleteTypeAndMoveToOther = () => {
        if (typeModalMode !== 'edit' || !typeEditingOriginalName) {
            return;
        }

        const targetType = typeEditingOriginalName;
        if (targetType === OTHER_TYPE) {
            return;
        }

        setTaskTypes(prev => {
            const next = prev.filter(type => type !== targetType);
            return next.includes(OTHER_TYPE) ? next : [...next, OTHER_TYPE];
        });

        setTaskTypeColors(prev => {
            const next = { ...prev };
            delete next[targetType];
            next[OTHER_TYPE] = prev[OTHER_TYPE] ?? defaultTypeColors[OTHER_TYPE];
            return next;
        });

        // Migrate all events with this type to `other`.
        setTasks(prev => prev.map(task => (
            task.type === targetType
                ? { ...task, type: OTHER_TYPE }
                : task
        )));

        if (modalDraft) {
            setModalDraft(prev => prev ? { ...prev, type: OTHER_TYPE } : prev);
        }

        if (filterType === targetType) {
            setFilterType(OTHER_TYPE);
        }

        closeTypeModal();
    };

    const getTaskStyle = (type: string) => {
        const backgroundColor = taskTypeColors[type] ?? (type === OTHER_TYPE ? defaultTypeColors[OTHER_TYPE] : '#dfe7ff');
        return {
            background: backgroundColor,
            color: getReadableTextColor(backgroundColor),
        };
    };

    const saveTaskModal = () => {
        if (!modalDraft || !modalDraft.title.trim()) {
            return;
        }

        if (isCreatingTask) {
            const dateForNewTask = creatingTaskDate;
            const newTask: CalendarTask = {
                id: nextTaskId,
                title: modalDraft.title.trim(),
                type: modalDraft.type,
                time: modalDraft.time,
                note: modalDraft.note,
                date: buildDateString(dateForNewTask),
            };
            setTasks(prev => [...prev, newTask]);
        } else if (selectedTask) {
            setTasks(prev => prev.map(task => (
                task.id === selectedTask.id
                    ? {
                        ...task,
                        title: modalDraft.title.trim(),
                        time: modalDraft.time,
                        note: modalDraft.note,
                        type: modalDraft.type,
                    }
                    : task
            )));
        }

        closeTaskModal();
    };

    const deleteTask = () => {
        if (!selectedTask) {
            return;
        }

        setTasks(prev => prev.filter(task => task.id !== selectedTask.id));
        closeTaskModal();
    };

    const handleDayClick = (day: CalendarDay) => {
        // const dayTasks = getTasksForDay(day);
        const date = new Date(day.year, day.month, day.day);
        // if (dayTasks.length === 0) {
            openCreateTaskModal(date);
            return;
        // }
    };

    const displayDate = dateTransition?.nextDate ?? currentDate;
    const effectiveViewMode: ViewMode = viewTransition?.toMode ?? viewMode;
    const filtersButtonText = isHeaderToolsOpen ? 'hide filters' : 'filters';

    return (
        <main className={`calendar-container ${viewMode === 'list' ? 'list-scroll-mode' : ''} ${isFilterRefreshActive ? 'filter-refresh-active' : ''}`}>
            <div className="calendar-header sticky-header">
                <div className="header-top-row">
                    <div className="calendar-nav">
                        {effectiveViewMode !== 'list' && (
                            <>
                                <button className="nav-btn" onClick={handlePrevMonth} disabled={dateTransition !== null || viewTransition !== null}>&lt;</button>
                                <button className="nav-btn" onClick={handleNextMonth} disabled={dateTransition !== null || viewTransition !== null}>&gt;</button>
                            </>
                        )}
                        <button className="today-btn" onClick={handleToday} disabled={viewTransition !== null || (dateTransition !== null && effectiveViewMode !== 'list')}>today</button>
                        <span className="button-divider" aria-hidden="true" />
                        <button className="nav-btn nav-new-event-btn" onClick={() => openCreateTaskModal(new Date())}>new event</button>
                        <button className="nav-btn nav-ai-create-btn" onClick={openAiCreateModal}>create with ai</button>
                    </div>

                    <div className="calendar-title">
                        {effectiveViewMode === 'week'
                            ? getWeekTitle(displayDate)
                            : effectiveViewMode === 'day'
                                ? getDayTitle(displayDate)
                                : effectiveViewMode === 'list'
                                    ? 'Task List'
                                : `${displayDate.toLocaleString('default', { month: 'long' })} ${displayDate.getFullYear()}`}
                    </div>

                    <div className="view-selector">
                        <button className={`view-btn ${effectiveViewMode === 'month' ? 'active' : ''}`} onClick={() => handleViewChange('month')} disabled={viewTransition !== null}>month</button>
                        <button className={`view-btn ${effectiveViewMode === 'week' ? 'active' : ''}`} onClick={() => handleViewChange('week')} disabled={viewTransition !== null}>week</button>
                        <button className={`view-btn ${effectiveViewMode === 'day' ? 'active' : ''}`} onClick={() => handleViewChange('day')} disabled={viewTransition !== null}>day</button>
                        <button className={`view-btn ${effectiveViewMode === 'list' ? 'active' : ''}`} onClick={() => handleViewChange('list')} disabled={viewTransition !== null}>list</button>
                        <span className="button-divider" aria-hidden="true" />
                        <button
                            className={`view-btn view-btn-filters ${isHeaderToolsOpen ? 'active' : ''}`}
                            onClick={() => setIsHeaderToolsOpen(prev => !prev)}
                            style={filtersButtonWidth ? { width: `${filtersButtonWidth}px` } : undefined}
                        >
                            {filtersButtonText}
                        </button>
                        <span className="view-btn-filters-measure" ref={filtersButtonMeasureRef} aria-hidden="true">
                            {filtersButtonText}
                        </span>
                    </div>
                </div>

                <div className={`header-tools-collapsible ${isHeaderToolsOpen ? 'open' : ''}`}>
                    <div className="header-tools">
                        <div className="header-tools-group">
                            <div className="header-tools-group-label"><label htmlFor="filterType">TYPE</label></div>
                            <select id="filterType" value={filterType} onChange={(event) => setFilterType(event.target.value)}>
                                <option value="all">All</option>
                                {taskTypes.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                        <div className="header-tools-group">
                            <div className="header-tools-group-label"><label htmlFor="filterKeyword">SEARCH</label></div>
                            <input
                                id="filterKeyword"
                                value={filterKeyword}
                                onChange={(event) => setFilterKeyword(event.target.value)}
                                placeholder=""
                            />
                        </div>
                        <div className="header-tools-group">
                            <div className="header-tools-group-label"><label htmlFor="searchScope">SCOPE</label></div>
                            <select id="searchScope" value={searchScope} onChange={(event) => setSearchScope(event.target.value as typeof searchScope)}>
                                <option value="all">All fields</option>
                                <option value="title">Title</option>
                                <option value="note">Note</option>
                                <option value="time">Time</option>
                                <option value="type">Type</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
            
            {viewTransition ? (
                <div className={`view-transition-viewport direction-${viewTransition.direction}`}>
                    <div className="view-transition-panel old-view">
                        {renderViewContent(viewTransition.fromMode, currentDate)}
                    </div>
                    <div className="view-transition-panel new-view">
                        {renderViewContent(viewTransition.toMode, currentDate)}
                    </div>
                </div>
            ) : viewMode === 'list' ? (
                renderViewContent('list', currentDate)
            ) : (
                <div className="calendar-transition-viewport">
                    {dateTransition ? (
                        <div className={`calendar-transition-track animating direction-${dateTransition.direction}`}>
                            <div className="calendar-transition-panel old-view">
                                {dateTransition.direction === 'backward'
                                    ? renderViewContent(viewMode, dateTransition.nextDate)
                                    : renderViewContent(viewMode, currentDate)}
                            </div>
                            <div className="calendar-transition-panel new-view">
                                {dateTransition.direction === 'backward'
                                    ? renderViewContent(viewMode, currentDate)
                                    : renderViewContent(viewMode, dateTransition.nextDate)}
                            </div>
                        </div>
                    ) : (
                        <div className="calendar-transition-single">
                            {renderViewContent(viewMode, currentDate)}
                        </div>
                    )}
                </div>
            )}

            {modalDraft && (
                <div className={`task-modal-backdrop ${isTaskModalClosing ? 'closing' : ''}`} onClick={closeTaskModal}>
                    <div className={`task-modal ${isTaskModalClosing ? 'closing' : ''}`} onClick={(event) => event.stopPropagation()}>
                        <div className="task-modal-header">
                            <h2>{isCreatingTask ? 'Create Event' : 'Edit Event'}</h2>
                            <button className="task-modal-close" onClick={closeTaskModal}>x</button>
                        </div>
                        {!isCreatingTask && selectedTask && (
                            <div className="task-modal-meta">
                                {parseTaskDate(selectedTask.date).toLocaleDateString('default', {
                                    weekday: 'long',
                                    month: 'long',
                                    day: 'numeric',
                                    year: 'numeric',
                                })}
                            </div>
                        )}

                        {isCreatingTask && (
                            <div className="task-modal-meta">
                                {creatingTaskDate.toLocaleDateString('default', {
                                    weekday: 'long',
                                    month: 'long',
                                    day: 'numeric',
                                    year: 'numeric',
                                })}
                            </div>
                        )}

                        <label className="task-modal-label">Title</label>
                        <input
                            className="task-modal-input"
                            value={modalDraft.title}
                            onChange={(event) => setModalDraft(prev => prev ? { ...prev, title: event.target.value } : prev)}
                        />

                        <label className="task-modal-label">Time</label>
                        <input
                            className="task-modal-input"
                            type="time"
                            value={modalDraft.time}
                            onChange={(event) => setModalDraft(prev => prev ? { ...prev, time: event.target.value } : prev)}
                        />

                        <label className="task-modal-label">Type</label>
                        <div className="type-select-row">
                            <select
                                className="task-modal-input"
                                value={modalDraft.type}
                                onChange={(event) => {
                                    const value = event.target.value as TaskType;
                                    if (value === ADD_TYPE_OPTION_VALUE) {
                                        openTypeCreateModal();
                                        return;
                                    }
                                    setModalDraft(prev => prev ? { ...prev, type: value } : prev);
                                }}
                            >
                                {taskTypes.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                                <option value={ADD_TYPE_OPTION_VALUE}>+ add new type...</option>
                            </select>
                            <button className="task-modal-btn" onClick={openTypeEditModal}>edit</button>
                        </div>

                        <label className="task-modal-label">Note</label>
                        <textarea
                            className="task-modal-textarea"
                            value={modalDraft.note}
                            onChange={(event) => setModalDraft(prev => prev ? { ...prev, note: event.target.value } : prev)}
                        />

                        <div className="task-modal-actions">
                            {!isCreatingTask && (
                                <button className="task-modal-btn danger" onClick={deleteTask}>Delete</button>
                            )}
                            <button className="task-modal-btn" onClick={closeTaskModal}>Cancel</button>
                            <button className="task-modal-btn primary" onClick={saveTaskModal}>Save</button>
                        </div>
                    </div>
                </div>
            )}

            {isTypeModalOpen && (
                <div className={`task-modal-backdrop ${isTypeModalClosing ? 'closing' : ''}`} onClick={closeTypeModal}>
                    <div className={`task-modal type-create-modal ${isTypeModalClosing ? 'closing' : ''}`} onClick={(event) => event.stopPropagation()}>
                        <div className="task-modal-header">
                            <h2>{typeModalMode === 'edit' ? 'Edit Type' : 'Create Type'}</h2>
                            <button className="task-modal-close" onClick={closeTypeModal}>x</button>
                        </div>

                        <label className="task-modal-label">Type Name</label>
                        <input
                            className="task-modal-input"
                            placeholder="e.g. study"
                            value={typeDraftName}
                            onChange={(event) => setTypeDraftName(event.target.value)}
                        />

                        <label className="task-modal-label">Type Color</label>
                        <div className="type-color-picker-row">
                            <input
                                className="type-color-input"
                                type="color"
                                value={isValidHexColor(typeDraftColor) ? typeDraftColor : '#4f7ef7'}
                                onChange={(event) => setTypeDraftColor(event.target.value)}
                            />
                            <input
                                className="task-modal-input"
                                value={typeDraftColor}
                                onChange={(event) => setTypeDraftColor(event.target.value)}
                            />
                        </div>

                        <div className="task-modal-actions">
                            {typeModalMode === 'edit' && typeEditingOriginalName !== OTHER_TYPE && (
                                <button className="task-modal-btn danger" onClick={deleteTypeAndMoveToOther}>
                                    Delete Type (move to other)
                                </button>
                            )}
                            <button className="task-modal-btn" onClick={closeTypeModal}>Cancel</button>
                            <button
                                className="task-modal-btn primary"
                                onClick={addTaskTypeWithColor}
                                disabled={!typeDraftName.trim() || !isValidHexColor(typeDraftColor)}
                            >
                                {typeModalMode === 'edit' ? 'Update Type' : 'Save Type'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isAiModalOpen && (
                <div className="task-modal-backdrop" onClick={closeAiCreateModal}>
                    <div className="task-modal ai-create-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="task-modal-header">
                            <h2>Create With AI</h2>
                            <button className="task-modal-close" onClick={closeAiCreateModal}>x</button>
                        </div>

                        <div className="ai-modal-grid">
                            <div className="ai-modal-section">
                                <label className="task-modal-label" htmlFor="aiTaskDescription">Task Description</label>
                                <textarea
                                    id="aiTaskDescription"
                                    className="task-modal-textarea"
                                    placeholder="Describe what you want to create..."
                                    value={aiTaskDescription}
                                    onChange={(event) => handleAiTaskDescriptionChange(event.target.value)}
                                />
                            </div>

                            <div className="ai-modal-section">
                                <label className="task-modal-label" htmlFor="aiReplyPanel">AI Response</label>
                                <div id="aiReplyPanel" className="ai-reply-panel">
                                    {aiReplyText || 'AI response will appear here.'}
                                </div>
                            </div>
                        </div>

                        <div className="task-modal-actions">
                            <button className="task-modal-btn" onClick={closeAiCreateModal}>Close</button>
                            <button
                                className="task-modal-btn primary"
                                onClick={handleCreateWithAi}
                                disabled={!aiTaskDescription.trim()}
                            >
                                Send To AI
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}

function App() {
    return (
        <div className="App">
            <MainCalendar />
        </div>
    );
}

export default App;
