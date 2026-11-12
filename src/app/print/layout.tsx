import type { ReactNode } from 'react';

/** No app chrome on the printable route — white page only. */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div style={{ background: '#fff', margin: 0 }}>{children}</div>;
}
