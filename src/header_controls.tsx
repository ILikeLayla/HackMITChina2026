import { useEffect, useRef, useState, type RefObject } from "react";
import type { SearchScope, ViewMode } from "./calendar_logic";

interface HeaderControlsProps {
    effectiveViewMode: ViewMode;
    displayTitle: string;
    currentDisplayDate: Date;
    dateTransitionActive: boolean;
    viewTransitionActive: boolean;
    isHeaderToolsOpen: boolean;
    filtersButtonWidth: number | null;
    filtersButtonText: string;
    filtersButtonMeasureRef: RefObject<HTMLSpanElement | null>;
    filterType: string;
    filterKeyword: string;
    searchScope: SearchScope;
    taskTypes: string[];
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    onJumpToDate: (date: Date) => void;
    onOpenCreateEvent: () => void;
    onOpenAiChat: () => void;
    onOpenSosPlanner: () => void;
    onSyncGoogleCalendar: () => void;
    isGoogleSyncing: boolean;
    onViewChange: (mode: ViewMode) => void;
    onToggleFilters: () => void;
    onFilterTypeChange: (value: string) => void;
    onFilterKeywordChange: (value: string) => void;
    onSearchScopeChange: (scope: SearchScope) => void;
}

export function HeaderControls({
    effectiveViewMode,
    displayTitle,
    currentDisplayDate,
    dateTransitionActive,
    viewTransitionActive,
    isHeaderToolsOpen,
    filtersButtonWidth,
    filtersButtonText,
    filtersButtonMeasureRef,
    filterType,
    filterKeyword,
    searchScope,
    taskTypes,
    onPrev,
    onNext,
    onToday,
    onJumpToDate,
    onOpenCreateEvent,
    onOpenAiChat,
    onOpenSosPlanner,
    onSyncGoogleCalendar,
    isGoogleSyncing,
    onViewChange,
    onToggleFilters,
    onFilterTypeChange,
    onFilterKeywordChange,
    onSearchScopeChange,
}: HeaderControlsProps) {
    const [isJumpToDateOpen, setIsJumpToDateOpen] = useState(false);
    const [jumpSelectedDate, setJumpSelectedDate] = useState(() => new Date(currentDisplayDate));
    const [jumpCalendarMonth, setJumpCalendarMonth] = useState(() => new Date(currentDisplayDate.getFullYear(), currentDisplayDate.getMonth(), 1));
    const jumpToDateRef = useRef<HTMLDivElement | null>(null);

    const dayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    const isSameCalendarDay = (left: Date, right: Date) => (
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate()
    );

    const getCalendarGridDays = (monthDate: Date) => {
        const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const firstWeekday = firstDay.getDay();
        const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
        const cells: Array<Date | null> = [];

        for (let index = 0; index < firstWeekday; index += 1) {
            cells.push(null);
        }

        for (let day = 1; day <= daysInMonth; day += 1) {
            cells.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
        }

        while (cells.length < 42) {
            cells.push(null);
        }

        return cells;
    };

    useEffect(() => {
        if (!isJumpToDateOpen) {
            setJumpSelectedDate(new Date(currentDisplayDate));
            setJumpCalendarMonth(new Date(currentDisplayDate.getFullYear(), currentDisplayDate.getMonth(), 1));
        }
    }, [currentDisplayDate, isJumpToDateOpen]);

    useEffect(() => {
        if (!isJumpToDateOpen) {
            return;
        }

        const handleOutsideClick = (event: MouseEvent) => {
            if (!jumpToDateRef.current?.contains(event.target as Node)) {
                setIsJumpToDateOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
        };
    }, [isJumpToDateOpen]);

    const handleToggleJumpToDate = () => {
        const nextOpen = !isJumpToDateOpen;
        if (nextOpen) {
            setJumpSelectedDate(new Date(currentDisplayDate));
            setJumpCalendarMonth(new Date(currentDisplayDate.getFullYear(), currentDisplayDate.getMonth(), 1));
        }
        setIsJumpToDateOpen(nextOpen);
    };

    const handleSubmitJumpToDate = () => {
        if (Number.isNaN(jumpSelectedDate.getTime())) {
            return;
        }

        onJumpToDate(jumpSelectedDate);
        setIsJumpToDateOpen(false);
    };

    const handleShiftJumpMonth = (direction: -1 | 1) => {
        setJumpCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
    };

    const handleSelectJumpDay = (dayDate: Date) => {
        setJumpSelectedDate(dayDate);
    };

    const handleJumpToday = () => {
        const today = new Date();
        setJumpSelectedDate(today);
        setJumpCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    };

    const jumpMonthLabel = `${jumpCalendarMonth.toLocaleString('default', { month: 'long' })} ${jumpCalendarMonth.getFullYear()}`;
    const jumpCalendarDays = getCalendarGridDays(jumpCalendarMonth);
    const today = new Date();

    return (
        <div className="calendar-header sticky-header">
            <div className="header-top-row">
                <div className="calendar-nav">
                    {effectiveViewMode !== 'list' && (
                        <>
                            <button className="nav-btn" onClick={onPrev} disabled={dateTransitionActive || viewTransitionActive}>&lt;</button>
                            <button className="nav-btn" onClick={onNext} disabled={dateTransitionActive || viewTransitionActive}>&gt;</button>
                        </>
                    )}
                    <button
                        className="today-btn"
                        onClick={onToday}
                        disabled={viewTransitionActive || (dateTransitionActive && effectiveViewMode !== 'list')}
                    >
                        today
                    </button>
                    <span className="button-divider" aria-hidden="true" />
                    <button className="nav-btn nav-new-event-btn" onClick={onOpenCreateEvent}>new item</button>
                    <button className="nav-btn nav-ai-create-btn" onClick={onOpenAiChat}>ai chat</button>
                    <button className="nav-btn" onClick={onSyncGoogleCalendar} disabled={isGoogleSyncing}>
                        {isGoogleSyncing ? 'syncing...' : 'sync google'}
                    </button>
                    <button className="nav-btn nav-sos-btn" onClick={onOpenSosPlanner}>SOS</button>
                </div>

                <div className="calendar-title" ref={jumpToDateRef}>
                    <button
                        type="button"
                        className="calendar-title-btn"
                        onClick={handleToggleJumpToDate}
                        aria-haspopup="dialog"
                        aria-expanded={isJumpToDateOpen}
                        title="Jump to date"
                    >
                        {displayTitle}
                    </button>
                    {isJumpToDateOpen && (
                        <div className="jump-to-date-popout" role="dialog" aria-label="Jump to date">
                            <div className="jump-to-date-month-header">
                                <button type="button" className="nav-btn jump-month-nav-btn" onClick={() => handleShiftJumpMonth(-1)}>&lt;</button>
                                <span>{jumpMonthLabel}</span>
                                <button type="button" className="nav-btn jump-month-nav-btn" onClick={() => handleShiftJumpMonth(1)}>&gt;</button>
                            </div>
                            <div className="jump-to-date-weekdays" aria-hidden="true">
                                {dayLabels.map(label => (
                                    <span key={label}>{label}</span>
                                ))}
                            </div>
                            <div className="jump-to-date-grid">
                                {jumpCalendarDays.map((dayDate, index) => {
                                    if (!dayDate) {
                                        return <span key={`empty-${index}`} className="jump-to-date-empty" aria-hidden="true" />;
                                    }

                                    const isSelected = isSameCalendarDay(dayDate, jumpSelectedDate);
                                    const isToday = isSameCalendarDay(dayDate, today);

                                    return (
                                        <button
                                            key={`${dayDate.getFullYear()}-${dayDate.getMonth()}-${dayDate.getDate()}`}
                                            type="button"
                                            className={`jump-to-date-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                                            onClick={() => handleSelectJumpDay(dayDate)}
                                        >
                                            {dayDate.getDate()}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="jump-to-date-actions">
                                <button type="button" className="nav-btn" onClick={handleJumpToday}>Today</button>
                                <button type="button" className="nav-btn" onClick={handleSubmitJumpToDate}>Go</button>
                                <button type="button" className="nav-btn" onClick={() => setIsJumpToDateOpen(false)}>Cancel</button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="view-selector">
                    <button className={`view-btn ${effectiveViewMode === 'month' ? 'active' : ''}`} onClick={() => onViewChange('month')} disabled={viewTransitionActive}>month</button>
                    <button className={`view-btn ${effectiveViewMode === 'week' ? 'active' : ''}`} onClick={() => onViewChange('week')} disabled={viewTransitionActive}>week</button>
                    <button className={`view-btn ${effectiveViewMode === 'day' ? 'active' : ''}`} onClick={() => onViewChange('day')} disabled={viewTransitionActive}>day</button>
                    <button className={`view-btn ${effectiveViewMode === 'list' ? 'active' : ''}`} onClick={() => onViewChange('list')} disabled={viewTransitionActive}>list</button>
                    <span className="button-divider" aria-hidden="true" />
                    <button
                        className={`view-btn view-btn-filters ${isHeaderToolsOpen ? 'active' : ''}`}
                        onClick={onToggleFilters}
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
                        <select id="filterType" value={filterType} onChange={(event) => onFilterTypeChange(event.target.value)}>
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
                            onChange={(event) => onFilterKeywordChange(event.target.value)}
                            placeholder=""
                        />
                    </div>
                    <div className="header-tools-group">
                        <div className="header-tools-group-label"><label htmlFor="searchScope">SCOPE</label></div>
                        <select id="searchScope" value={searchScope} onChange={(event) => onSearchScopeChange(event.target.value as SearchScope)}>
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
    );
}
