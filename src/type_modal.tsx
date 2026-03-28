import type { Dispatch, SetStateAction } from "react";
import { isValidHexColor } from "./general_utils";

interface TypeModalProps {
    isOpen: boolean;
    isClosing: boolean;
    shouldElevate: boolean;
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
    isClosing,
    shouldElevate,
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
    if (!isOpen) {
        return null;
    }

    return (
        <div
            className={`task-modal-backdrop ${isClosing ? 'closing' : ''} ${shouldElevate ? 'modal-over-ai' : ''}`}
            onClick={onClose}
        >
            <div className={`task-modal type-create-modal ${isClosing ? 'closing' : ''}`} onClick={(event) => event.stopPropagation()}>
                <div className="task-modal-header">
                    <h2>{mode === 'edit' ? 'Edit Type' : 'Create Type'}</h2>
                    <button className="task-modal-close" onClick={onClose}>x</button>
                </div>

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

                <div className="task-modal-actions">
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
        </div>
    );
}
