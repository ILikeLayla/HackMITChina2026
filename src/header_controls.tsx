import type { RefObject } from "react";
import type { SearchScope, ViewMode } from "./calendar_logic";

interface HeaderControlsProps {
    effectiveViewMode: ViewMode;
    displayTitle: string;
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

                <div className="calendar-title">{displayTitle}</div>

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
