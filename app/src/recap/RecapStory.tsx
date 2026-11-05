import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Cross1Icon, EnterFullScreenIcon, PauseIcon, PlayIcon } from '@radix-ui/react-icons';
import type { RecapCard } from './cards';
import { storyIndex, swipeStep } from './storyNavigation';

interface Props {
  cards: RecapCard[]; index: number; onChange: (index: number) => void; label: string;
  onShare: () => void; onDownload: () => void; ready: boolean; sharing: boolean;
  message?: string; exportError?: string;
}
const SLIDE_SECONDS = 7;

function StoryProgress({ cards, current, playing = false, holding = false }: {
  cards: RecapCard[]; current: number; playing?: boolean; holding?: boolean;
}) {
  const card = cards[current];
  return <div className="story-progress" role="progressbar" aria-label="Recap progress" aria-valuemin={1} aria-valuemax={cards.length} aria-valuenow={current + 1} aria-valuetext={`${current + 1} of ${cards.length}: ${card.title}`}>
    {cards.map((slide, i) => <span aria-hidden="true" key={slide.id} className={`${i < current ? 'complete' : ''} ${i === current ? 'current' : ''} ${playing && !holding && i === current ? 'playing' : ''} ${holding ? 'holding' : ''}`} />)}
  </div>;
}

function StoryStage({ card, label, current, count, onNavigate, onHoldingChange }: {
  card: RecapCard; label: string; current: number; count: number;
  onNavigate: (step: number) => void; onHoldingChange: (holding: boolean) => void;
}) {
  const pointer = useRef<{ x: number; y: number; id: number }>();
  const suppressClick = useRef(false);

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary) return;
    pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    suppressClick.current = false;
    onHoldingChange(true);
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    const start = pointer.current;
    pointer.current = undefined; onHoldingChange(false);
    if (!start || start.id !== event.pointerId) return;
    const step = swipeStep(event.clientX - start.x, event.clientY - start.y);
    if (step) { suppressClick.current = true; onNavigate(step); }
  }

  function tap(step: number) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onNavigate(step);
  }

  return <div className="story-stage" onPointerDown={startPointer} onPointerUp={finishPointer}
    onPointerLeave={(event) => { if (event.pointerType === 'mouse') { pointer.current = undefined; onHoldingChange(false); } }}
    onPointerCancel={() => { pointer.current = undefined; onHoldingChange(false); }}>
    <img key={card.id} className="story-art" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(card.svg)}`} alt={`${label}. ${card.description}`} draggable={false} />
    <button className="story-tap previous" aria-label="Previous story card" disabled={current === 0} onClick={() => tap(-1)} />
    <button className="story-tap next" aria-label="Next story card" disabled={current === count - 1} onClick={() => tap(1)} />
  </div>;
}

function StoryNavigation({ current, count, onNavigate }: {
  current: number; count: number; onNavigate: (step: number) => void;
}) {
  return <div className="card-pagination"><button aria-label="Previous recap card" disabled={current === 0} onClick={() => onNavigate(-1)}>Previous</button><span aria-live="polite">{current + 1} / {count}</span><button aria-label="Next recap card" disabled={current === count - 1} onClick={() => onNavigate(1)}>Next</button></div>;
}

export function RecapStory({ cards, index, onChange, label, onShare, onDownload, ready, sharing, message, exportError }: Props) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [holding, setHolding] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = storyIndex(index, cards.length);
  const card = cards[current];
  const change = (step: number) => onChange(storyIndex(current, cards.length, step));
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!open || !playing || holding) return;
    if (current === cards.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => onChange(current + 1), SLIDE_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [open, playing, holding, current, cards.length, onChange]);
  if (!card) return null;
  function close() { setOpen(false); setPlaying(false); setHolding(false); }
  return <>
    <div className="recap-preview story-preview" onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); change(event.key === 'ArrowRight' ? 1 : -1); } }}>
      <StoryProgress cards={cards} current={current} />
      <StoryStage card={card} label={label} current={current} count={cards.length} onNavigate={change} onHoldingChange={setHolding} />
      <StoryNavigation current={current} count={cards.length} onNavigate={change} />
      <button className="story-launch" onClick={() => { setPlaying(false); setOpen(true); }}><EnterFullScreenIcon aria-hidden="true" /> View full-screen recap</button>
    </div>
    <dialog ref={dialogRef} className="recap-story-dialog" aria-label={`${label} reading recap`} onCancel={(event) => { event.preventDefault(); close(); }} onClose={close}
      onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); change(event.key === 'ArrowRight' ? 1 : -1); } }}>
      <div className="story-shell">
        <header className="story-header"><span>{label}</span><button className="story-close" autoFocus aria-label="Close recap" onClick={close}><Cross1Icon aria-hidden="true" /></button></header>
        <StoryProgress cards={cards} current={current} playing={playing} holding={holding} />
        <div className="story-screen"><StoryStage card={card} label={label} current={current} count={cards.length} onNavigate={change} onHoldingChange={setHolding} /></div>
        <div className="story-footer">
          <StoryNavigation current={current} count={cards.length} onNavigate={change} />
          <div className="story-export-actions">
            <button aria-label={playing ? 'Pause recap' : 'Play recap'} disabled={current === cards.length - 1} onClick={() => setPlaying((value) => !value)}>{playing ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}{playing ? 'Pause' : 'Play'}</button>
            <button className="primary" disabled={!ready || sharing} onClick={onShare}>{sharing ? 'Sharing…' : 'Share card'}</button>
            <button disabled={!ready} onClick={onDownload}>Save image</button>
          </div>
          {exportError && <p className="small" role="alert">{exportError}</p>}
          {message && <p className="small" role="status">{message}</p>}
        </div>
      </div>
    </dialog>
  </>;
}
