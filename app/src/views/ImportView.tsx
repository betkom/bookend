import { useState } from 'react';
import { importers, ImportError, type Importer } from '@importers/index';
import { db, type ImportBatch } from '../db';
import { findDuplicateBatch, importFile } from '../importService';

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'duplicate'; file: File; text: string; previous: ImportBatch }
  | { kind: 'done'; batch: ImportBatch; warnings: string[] }
  | { kind: 'error'; message: string };

export function ImportView({ onDone }: { onDone: () => void }) {
  const [importer, setImporter] = useState<Importer>(importers[0]);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);

  async function run(file: File, text: string) {
    setState({ kind: 'busy' });
    try {
      const { batch, warnings } = await importFile(db, importer, text, file.name);
      setState({ kind: 'done', batch, warnings });
    } catch (e) {
      const message = e instanceof ImportError ? e.message : `Something went wrong reading ${file.name}.`;
      if (!(e instanceof ImportError)) console.error(e);
      setState({ kind: 'error', message });
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file || state.kind === 'busy') return;
    setState({ kind: 'busy' });
    try {
      const text = await file.text();
      const previous = await findDuplicateBatch(db, text);
      if (previous) setState({ kind: 'duplicate', file, text, previous });
      else await run(file, text);
    } catch { setState({ kind: 'error', message: `Could not read ${file.name}. Please choose the file again.` }); }
  }

  return (
    <section>
      {importers.length > 1 && (
        <div className="sources">
          {importers.map((i) => (
            <button key={i.source} disabled={state.kind === 'busy'} className={i === importer ? 'on' : ''} onClick={() => { setImporter(i); setState({ kind: 'idle' }); }}>
              {i.label}
            </button>
          ))}
        </div>
      )}
      <h2>Import from {importer.label}</h2>
      <details className="help"><summary>How to export from {importer.label}</summary><p>{importer.howToExport}</p></details>

      <label
        className={`drop ${dragging ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files[0]);
        }}
      >
        <input
          aria-label={`Choose ${importer.label} export`}
          type="file"
          disabled={state.kind === 'busy'}
          accept={importer.accept.join(',')}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <strong>Choose a file</strong><span className="muted small">{importer.accept.join(' or ')} · You can also drop it here</span>
      </label>

      {state.kind === 'busy' && <p className="muted">Importing…</p>}

      {state.kind === 'duplicate' && (
        <div className="notice warn">
          <p>
            You already imported this exact file on {new Date(state.previous.importedAt).toLocaleDateString()} (
            {state.previous.fileName}). Importing it again would duplicate its events.
          </p>
          <div className="row">
            <button onClick={() => setState({ kind: 'idle' })}>Cancel</button>
            <button onClick={() => run(state.file, state.text)}>Import anyway</button>
          </div>
        </div>
      )}

      {state.kind === 'error' && <div className="notice error">{state.message}</div>}

      {state.kind === 'done' && (
        <div className="notice ok">
          <p>
            Imported <strong>{state.batch.eventCount}</strong> events from {state.batch.fileName}. You can undo this import
            from the Data tab.
          </p>
          {state.warnings.length > 0 && (
            <ul className="small">
              {state.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <button className="primary" onClick={onDone}>
            See your reads
          </button>
        </div>
      )}
    </section>
  );
}

