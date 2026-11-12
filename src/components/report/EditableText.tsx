'use client';

import { useEffect, useRef } from 'react';

/**
 * An auto-growing textarea that looks like body text until focused.
 * Locked (read-only) once the report is approved.
 */
export function EditableText({
  value,
  onChange,
  readOnly,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // field-sizing: content handles this in Chromium; this keeps Safari/Firefox usable.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="report-field"
      aria-label={ariaLabel}
      value={value}
      readOnly={readOnly}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
