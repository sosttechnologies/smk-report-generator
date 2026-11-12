'use client';

import { useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS } from '@/lib/ingest';

export interface UploadOutcome {
  terms: unknown[];
  method: 'spreadsheet' | 'document';
  notes: string[];
  issues: { row: number; field: string; message: string }[];
  unmappedHeaders: string[];
  submissionCount: number;
  filename: string;
}

export function UploadPanel({ onLoaded }: { onLoaded: (result: UploadOutcome) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append('file', file);
    try {
      const response = await fetch('/api/upload', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Upload failed');
        return;
      }
      onLoaded(data as UploadOutcome);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F2E9DC] p-6">
      <div className="w-full max-w-xl">
        <h1 className="font-display text-4xl tracking-wide text-[#2A211B]">SIEVEMK</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.24em] text-[#8A7863]">
          Termly report generator
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void send(file);
          }}
          className={`mt-7 rounded-md border-2 border-dashed p-12 text-center transition-colors ${
            dragging ? 'border-[#2A211B] bg-[#FBF7F0]' : 'border-[#DCCDB6] bg-[#FBF7F0]/60'
          }`}
        >
          <p className="text-lg text-[#2A211B]">
            {busy ? 'Reading your file…' : 'Drop the tutor submissions here'}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[#8A7863]">
            Microsoft Forms export (.xlsx, .csv) is read directly.
            <br />
            PDF, Word, text and images are read by Claude and shown for checking.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="mt-6 rounded bg-[#2A211B] px-6 py-3 text-sm uppercase tracking-[0.12em] text-[#F2E9DC] transition-colors hover:bg-[#3D3128] disabled:opacity-45"
          >
            Choose a file
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void send(file);
              e.target.value = '';
            }}
          />
        </div>

        {error && (
          <p className="mt-4 rounded bg-[#F6E4DE] px-4 py-3 text-sm text-[#9A3B2F]">{error}</p>
        )}

        <p className="mt-6 text-xs leading-relaxed text-[#8A7863]">
          Nothing is finalised or exported until a member of staff approves it.
        </p>
      </div>
    </div>
  );
}
