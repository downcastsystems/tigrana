import { useEffect, useState } from "react";
import type { WorkspaceMetadata } from "../types";
import { dailyWritingCounts, localWritingDay, readWritingProgress } from "../lib/writingProgress";

export function WritingProgressPane({ metadata, noteId, onGoalChange }: {
  metadata: WorkspaceMetadata; noteId: string | null;
  onGoalChange?: (noteId: string | null, goal: number | null) => void;
}) {
  const [day, setDay] = useState(localWritingDay);
  useEffect(() => {
    const update = () => setDay(localWritingDay());
    const timer = window.setInterval(update, 30000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const counts = dailyWritingCounts(metadata, day, noteId);
  const goals = readWritingProgress(metadata);
  return <div className="writing-progress-pane">
    <div className="writing-progress-rings">
      <GoalRing label="Entire Notebook" count={counts.notebook} goal={goals.notebookGoal} onChange={onGoalChange ? goal => onGoalChange(null, goal) : undefined} />
      <GoalRing key={noteId ?? "none"} label="This Note" count={counts.note} goal={noteId ? goals.noteGoals[noteId] : undefined}
        onChange={noteId && onGoalChange ? goal => onGoalChange(noteId, goal) : undefined} />
    </div>
    <p className="sidebar-hint">Words added today, minus deletions.</p>
  </div>;
}

function GoalRing({ label, count, goal, onChange }: {
  label: string; count: number; goal?: number; onChange?: (goal: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const validGoal = goal && Number.isFinite(goal) && goal > 0 ? goal : undefined;
  const fraction = validGoal ? Math.min(1, count / validGoal) : 0;
  return <div className="writing-goal">
    <span className="writing-goal-label">{label}</span>
    <div className="writing-ring" role="img" aria-label={`${label}: ${count} words today${validGoal ? ` of ${validGoal}` : ", no goal set"}`}>
      <svg viewBox="0 0 64 64" aria-hidden="true"><circle className="writing-ring-track" cx="32" cy="32" r="27" />
        <circle className="writing-ring-value" cx="32" cy="32" r="27" pathLength="100" strokeDasharray={`${fraction * 100} 100`} /></svg>
      <strong>{count.toLocaleString()}</strong>
    </div>
    <span className="sidebar-hint">{validGoal ? `of ${validGoal.toLocaleString()} words` : "No goal set"}</span>
    {editing ? <form className="writing-goal-form" onSubmit={event => {
      event.preventDefault();
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 1 || number > 1000000) return;
      onChange?.(number); setEditing(false);
    }}>
      <input className="dialog-input settings-number-input" aria-label={`${label} daily word goal`} type="number" min="1" max="1000000" step="1" required autoFocus value={value} onChange={event => setValue(event.target.value)} />
      <button className="primary-button" type="submit">Save</button><button className="toolbar-button" type="button" onClick={() => setEditing(false)}>Cancel</button>
      {validGoal && <button className="toolbar-button" type="button" onClick={() => { onChange?.(null); setEditing(false); }}>Remove goal</button>}
    </form> : <button type="button" className="sidebar-text-button" disabled={!onChange} onClick={() => { setValue(String(validGoal ?? 500)); setEditing(true); }}>
      {validGoal ? "Edit goal" : "Set goal"}
    </button>}
  </div>;
}
