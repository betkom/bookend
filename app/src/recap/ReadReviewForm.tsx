import { Select } from '../components/Select';
import { useState } from 'react';
import type { Read } from '../db';

export const readStatusLabel = { 'in-progress': 'In progress', finished: 'Finished', abandoned: 'Abandoned', 'not-read': 'Did not read' };

/** One explicit save keeps date edits and status changes together. */
export function ReadReviewForm({ status, initialDate, initialStart, startOptional, disabled, onSave, onReset, resetLabel = 'Undo review' }: {
  status?: Read['status']; initialDate: string; initialStart: string; startOptional?: boolean; disabled?: boolean;
  onSave: (status: Read['status'], date: string, start: string) => Promise<void>;
  onReset?: () => Promise<void>; resetLabel?: string;
}) {
  const [choice, setChoice] = useState<Read['status'] | ''>(status ?? '');
  const [date, setDate] = useState(status === 'in-progress' ? '' : initialDate);
  const [start, setStart] = useState(initialStart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(reset = false) {
    setBusy(true); setError(''); setSaved(false);
    try {
      if (reset) { await onReset?.(); setChoice(''); }
      else if (choice) await onSave(choice, date, start);
      setSaved(true);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save. Try again.'); }
    finally { setBusy(false); }
  }
  return <form className="read-form" onSubmit={(event) => { event.preventDefault(); void submit(); }} onChange={() => setSaved(false)} onInput={() => setSaved(false)}>
    <label>Status<Select value={choice} onChange={(event) => {
      const status = event.target.value as Read['status'];
      setChoice(status);
      if (status === 'in-progress') setDate('');
    }} disabled={busy} required>
      <option value="" disabled>Choose a status</option>
      <option value="in-progress">In progress</option><option value="finished">Finished</option><option value="abandoned">Abandoned</option><option value="not-read">Did not read</option>
    </Select></label>
    {choice && choice !== 'not-read' && <div className="review-dates">
      <label>Started{startOptional && choice !== 'in-progress' ? ' (optional)' : ''}<input type="date" value={start} max={choice === 'in-progress' ? undefined : date || undefined} required={!startOptional || choice === 'in-progress'} onInput={(event) => setStart(event.currentTarget.value)} disabled={busy} /></label>
      <label>{choice === 'abandoned' ? 'Set aside' : choice === 'in-progress' ? 'Finished (optional)' : 'Finished'}<input type="date" value={date} min={start || undefined} required={choice !== 'in-progress'} onInput={(event) => {
        const value = event.currentTarget.value;
        setDate(value);
        if (choice === 'finished' && !value) setChoice('in-progress');
        else if (choice === 'in-progress' && value) setChoice('finished');
      }} disabled={busy} /></label>
    </div>}
    {choice === 'in-progress' && <p className="small muted">Leave Finished empty while you’re still reading. It won’t count as a finished book in Recap.</p>}
    {choice === 'not-read' && <p className="small muted">Excluded from your recap. No dates needed.</p>}
    <div className="review-actions">
      <button className="primary" disabled={busy || disabled || !choice}>{busy ? 'Saving…' : 'Save review'}</button>
      {onReset && <button type="button" className="link" disabled={busy} onClick={() => submit(true)}>{resetLabel}</button>}
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {saved && <p className="small" role="status">Saved.</p>}
  </form>;
}
