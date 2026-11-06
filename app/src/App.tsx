import { useEffect, useRef, useState } from 'react';
import { HamburgerMenuIcon, Cross1Icon } from '@radix-ui/react-icons';
import { ReadsView } from './views/ReadsView';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { libbyLoans } from './loans';
import { LoansView } from './views/LoansView';
import { ImportView } from './views/ImportView';
import { AddPaperView } from './views/AddPaperView';
import { DataView } from './views/DataView';
import { RecapView } from './views/RecapView';

const TABS = [
  { id: 'reads', label: 'Reads' },
  { id: 'loans', label: 'Loans' },
  { id: 'recap', label: 'Recap' },
  { id: 'import', label: 'Import' },
  { id: 'paper', label: 'Add book' },
  { id: 'data', label: 'Data' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>('reads');
  const hasLoans = useLiveQuery(async () => libbyLoans(await db.events.where('source').equals('libby').toArray()).length > 0, []);
  useEffect(() => {
    if (tab === 'loans' && hasLoans === false) setTab('reads');
  }, [tab, hasLoans]);
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setMenuOpen(false);
    }

    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMenuOpen(false); menuButtonRef.current?.focus();
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);
  return (
    <div className="shell">
      <div className="site-header" ref={headerRef}>
      <header className="top">
        <h1>Bookend</h1>
        <p className="tag">Your reading journal</p>
        <button className="menu-toggle" ref={menuButtonRef} aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <Cross1Icon aria-hidden="true" /> : <HamburgerMenuIcon aria-hidden="true" />}
        </button>
      </header>
      <nav id="main-navigation" className={`tabs${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation">
        {TABS.filter((t) => t.id !== 'loans' || hasLoans).map((t) => (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setMenuOpen(false); if (menuOpen) menuButtonRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }}>
            {t.label}
          </button>
        ))}
      </nav>
      </div>
      <main>
        {tab === 'reads' && <ReadsView onGoImport={() => setTab('import')} onAddBook={() => setTab('paper')} />}
        {tab === 'loans' && hasLoans && <LoansView />}
        {tab === 'recap' && <RecapView />}
        {tab === 'import' && <ImportView onDone={() => setTab('reads')} />}
        {tab === 'paper' && <AddPaperView onDone={() => setTab('reads')} />}
        {tab === 'data' && <DataView />}
      </main>
      <footer className="foot">Your data stays on this device. Book info from Libby and Open Library.</footer>
    </div>
  );
}

