import type { Dispatch, SetStateAction } from "react";
import { isValidHexColor } from "./general_utils";

interface TypeModalProps {
    isOpen: boolean;
    mode: 'create' | 'edit';
    editingOriginalName: string | null;
    draftName: string;
    draftColor: string;
    otherType: string;
    onClose: () => void;
    onSave: () => void;
    onDeleteAndMoveToOther: () => void;
    setDraftName: Dispatch<SetStateAction<string>>;
    setDraftColor: Dispatch<SetStateAction<string>>;
}

export function TypeModal({
    isOpen,
    mode,
    editingOriginalName,
    draftName,
    draftColor,
    otherType,
    onClose,
    onSave,
    onDeleteAndMoveToOther,
    setDraftName,
    setDraftColor,
}: TypeModalProps) {
    return (
        <aside className={`panel-sidebar panel-sidebar-elevated ${isOpen ? 'open' : ''}`}>
            <div className="panel-sidebar-header">
                <h2>{mode === 'edit' ? 'Edit Type' : 'Create Type'}</h2>
                <button className="ai-sidebar-close" onClick={onClose} aria-label="Close">✕</button>
            </div>

            <div className="panel-sidebar-body">
                <label className="task-modal-label">Type Name</label>
                <input
                    className="task-modal-input"
                    placeholder="e.g. study"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                />

                <label className="task-modal-label">Type Color</label>
                <div className="type-color-picker-row">
                    <input
                        className="type-color-input"
                        type="color"
                        value={isValidHexColor(draftColor) ? draftColor : '#4f7ef7'}
                        onChange={(event) => setDraftColor(event.target.value)}
                    />
                    <input
                        className="task-modal-input"
                        value={draftColor}
                        onChange={(event) => setDraftColor(event.target.value)}
                    />
                </div>

                <div className="panel-sidebar-actions">
                    {mode === 'edit' && editingOriginalName !== otherType && (
                        <button className="task-modal-btn danger" onClick={onDeleteAndMoveToOther}>
                            Delete Type (move to other)
                        </button>
                    )}
                    <button className="task-modal-btn" onClick={onClose}>Cancel</button>
                    <button
                        className="task-modal-btn primary"
                        onClick={onSave}
                        disabled={!draftName.trim() || !isValidHexColor(draftColor)}
                    >
                        {mode === 'edit' ? 'Update Type' : 'Save Type'}
                    </button>
                </div>
            </div>
        </aside>
    );
}
