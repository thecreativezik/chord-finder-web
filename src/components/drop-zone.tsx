// File import: drag-and-drop plus a browser file picker.

import { useCallback, useRef, useState, type DragEvent } from "react";
import { MusicIcon } from "lucide-react";

const ACCEPT = ".mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.aiff,.aif,audio/*";

export interface FileImportHandlers {
  onFile: (file: File) => void;
}

export interface DragProps {
  onDragEnter: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

export interface UseFileImport {
  isDragging: boolean;
  dragProps: DragProps;
  openPicker: () => void;
}

export function useFileImport({ onFile }: FileImportHandlers): UseFileImport {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  const onDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    depth.current += 1;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const openPicker = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) onFile(file);
    };
    input.click();
  }, [onFile]);

  return { isDragging, dragProps: { onDragEnter, onDragOver, onDragLeave, onDrop }, openPicker };
}

interface DropZoneEmptyProps {
  onPick: () => void;
}

/** The initial empty state shown before any song is loaded. */
export function DropZoneEmpty({ onPick }: DropZoneEmptyProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
      <MusicIcon className="size-10 text-quaternary" />
      <h2 className="text-lg font-semibold">Drop a song to find its chords</h2>
      <p className="max-w-md text-small text-tertiary">
        Drag an audio file here, or import one to detect its key, tempo, and full chord
        progression. Everything runs in your browser — nothing is uploaded.
      </p>
      <button
        type="button"
        onClick={onPick}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast transition-opacity hover:opacity-90 [&_svg]:size-4"
      >
        <MusicIcon />
        Import Audio File
      </button>
    </div>
  );
}

/** Overlay shown while a file is being dragged over the window. */
export function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-well/80">
      <span className="text-lg font-semibold text-accent">Drop to analyze</span>
    </div>
  );
}
