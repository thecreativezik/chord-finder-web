import { ExternalLinkIcon, FolderOpenIcon, SearchIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface MusicSourcesProps {
  open: boolean;
  onClose: () => void;
  onOpenFile: () => void;
}

const SERVICES = [
  {
    name: "Spotify",
    color: "#1ed760",
    url: (query: string) => `https://open.spotify.com/search/${encodeURIComponent(query)}`,
  },
  {
    name: "Apple Music",
    color: "#fa586a",
    url: (query: string) => `https://music.apple.com/us/search?term=${encodeURIComponent(query)}`,
  },
  {
    name: "TIDAL",
    color: "#ffffff",
    url: (query: string) => `https://listen.tidal.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    name: "YouTube",
    color: "#ff3b30",
    url: (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
  },
];

export function MusicSources({ open, onClose, onOpenFile }: MusicSourcesProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href]:not([aria-disabled="true"]), button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="studio-panel w-full max-w-2xl overflow-hidden rounded-xl" role="dialog" aria-modal="true" aria-labelledby="music-sources-title">
        <header className="flex items-start justify-between gap-4 border-b border-separator px-5 py-4">
          <div>
            <h2 id="music-sources-title" className="text-base font-semibold">Add or find a song</h2>
            <p className="mt-1 text-small text-tertiary">Analyze audio you own, or find the catalog version on your listening service.</p>
          </div>
          <button type="button" onClick={onClose} className="transport-icon" aria-label="Close music sources"><XIcon /></button>
        </header>

        <div className="space-y-5 p-5">
          <button type="button" onClick={() => { onClose(); onOpenFile(); }} className="flex w-full items-center gap-3 rounded-lg border border-accent/35 bg-accent/10 p-4 text-left transition hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-accent">
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-contrast"><FolderOpenIcon className="size-4" /></span>
            <span>
              <strong className="block text-sm text-primary">Open an audio file</strong>
              <span className="text-small text-tertiary">Full chord analysis, separation, key change, practice, and export</span>
            </span>
          </button>

          <div>
            <label htmlFor="catalog-search" className="text-mini-strong text-secondary">Find on a music service</label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-separator bg-well px-3">
              <SearchIcon className="size-4 shrink-0 text-tertiary" aria-hidden="true" />
              <input ref={inputRef} id="catalog-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Song, artist, or album" className="min-w-0 flex-1 bg-transparent py-3 text-sm text-primary outline-none" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SERVICES.map((service) => (
                <a
                  key={service.name}
                  href={service.url(query.trim())}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!query.trim()}
                  tabIndex={query.trim() ? 0 : -1}
                  onClick={(event) => { if (!query.trim()) event.preventDefault(); }}
                  className={`flex min-h-11 items-center justify-between gap-2 rounded-md border border-separator bg-control-subtle px-3 text-xs font-semibold transition hover:border-accent/35 ${query.trim() ? "text-primary" : "pointer-events-none opacity-45"}`}
                >
                  <span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ backgroundColor: service.color }} />{service.name}</span>
                  <ExternalLinkIcon className="size-3 text-tertiary" />
                </a>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-separator bg-well/70 p-3 text-[11px] leading-4 text-tertiary">
            <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
            <p>
              These services only allow playback in their licensed players; they do not provide raw audio for chord detection, separation, transposition, or remix export. Chord Finder therefore opens a catalog search and never records or extracts protected streams.
              {" "}<a href={new URL("legal/index.html", document.baseURI).href} target="_blank" rel="noreferrer" className="font-semibold text-accent underline decoration-accent/40 underline-offset-2">Source &amp; licenses</a>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
