import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { undoBatch } from '../importService';
import { exportBackup, restoreBackup } from '../backup';

export function DataView() {
  const batches = useLiveQuery(() => db.importBatches.orderBy('importedAt').reverse().toArray(), []);
  const counts = useLiveQuery(
    async () => ({ events: await db.events.count(), works: await db.works.count(), editions: await db.editions.count() }),
    [],
  );
  const [message, setMessage] = useState('');

  async function download() {
    const backup = await exportBackup(db);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bookend-backup-${backup.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    if (!confirm('Restoring replaces everything currently in Bookend on this device. Continue?')) return;
    try {
      await restoreBackup(db, await file.text());
      setMessage('Backup restored.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Restore failed.');
    }
  }

  async function undo(id: string, name: string) {
    if (!confirm(`Remove "${name}" and all events it added?`)) return;
    await undoBatch(db, id);
  }

  return (
    <section>
      <h2>Your data</h2>
      {counts && (
        <p className="muted">
          {counts.works} books · {counts.events} activities, saved on this device.
        </p>
      )}

      <div className="card">
        <h3>Backup</h3>
        <p className="small">
          Browsers can clear local data. Download a backup now and then, and keep it somewhere safe.
        </p>
        <div className="row">
          <button className="primary" onClick={download}>
            Download backup
          </button>
          <label className="button">
            Restore from file
            <input aria-label="Restore backup" type="file" accept=".json" onChange={(e) => restore(e.target.files?.[0])} />
          </label>
        </div>
        {message && <p className="small">{message}</p>}
      </div>

      <div className="card">
        <h3>Imports</h3>
        {!batches?.length && <p className="muted small">No imports yet.</p>}
        <ul className="batches">
          {batches?.map((b) => (
            <li key={b.id}>
              <span>
                <strong>{b.fileName}</strong>
                <span className="muted small">
                  {' '}
                  · {new Date(b.importedAt).toLocaleString()} · {b.eventCount} events
                </span>
              </span>
              <button className="link danger" onClick={() => undo(b.id, b.fileName)}>
                Undo
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

