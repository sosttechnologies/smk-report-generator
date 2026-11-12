'use client';

import { EditableText } from './EditableText';

/**
 * A bulleted list edited as one textarea, one bullet per line.
 * Staff think in lines; the document renders <li> elements.
 */
export function EditableList({
  items,
  onChange,
  readOnly,
  ariaLabel,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  readOnly: boolean;
  ariaLabel: string;
}) {
  if (readOnly) {
    return (
      <ul>
        {items.filter(Boolean).map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }

  return (
    <EditableText
      ariaLabel={ariaLabel}
      readOnly={false}
      value={items.join('\n')}
      onChange={(next) => onChange(next.split('\n'))}
    />
  );
}
