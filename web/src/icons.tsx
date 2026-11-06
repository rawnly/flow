import type { SVGProps } from "react";

const base = (d: React.ReactNode) => (p: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {d}
  </svg>
);

export const Icon = {
  logo: base(<><rect x="1.75" y="2.75" width="6.5" height="4.5" rx="1.5" /><rect x="8" y="9" width="6.25" height="4.5" rx="1.5" fill="currentColor" stroke="none" /><path d="M5 7.25v4h3" /></>),
  copy: base(<><rect x="5.25" y="5.25" width="8" height="8" rx="2" /><path d="M10.75 5.25v-1.5a1.5 1.5 0 0 0-1.5-1.5h-5a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1.5 1.5h1.5" /></>),
  download: base(<><path d="M8 2.5v8M4.75 7.5 8 10.75l3.25-3.25M2.75 13.25h10.5" /></>),
  chevron: base(<path d="m4.5 6.25 3.5 3.5 3.5-3.5" />),
  plus: base(<path d="M8 3.25v9.5M3.25 8h9.5" />),
  minus: base(<path d="M3.25 8h9.5" />),
  fit: base(<path d="M2.75 6V3.75a1 1 0 0 1 1-1H6M10 2.75h2.25a1 1 0 0 1 1 1V6M13.25 10v2.25a1 1 0 0 1-1 1H10M6 13.25H3.75a1 1 0 0 1-1-1V10" />),
  check: base(<path d="m3.5 8.25 3 3 6-6.5" />),
  undo: base(<><path d="M5.5 4.5 2.75 7.25 5.5 10" /><path d="M3 7.25h6.25a4 4 0 0 1 0 8h-1" transform="translate(0 -2.5)" /></>),
  trash: base(<><path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.4a1 1 0 0 0 1 .85h4.8a1 1 0 0 0 1-.85l.6-8.4" /></>),
  send: base(<path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" />),
  close: base(<path d="m4 4 8 8M12 4l-8 8" />),
  alert: base(<><path d="M8 2.5 14 13H2Z" /><path d="M8 6.5v3M8 11.25v.01" /></>),
  terminal: base(<><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" /><path d="m4.5 6 2 2-2 2M8.5 10.25h3" /></>),
  comment: base(<path d="M3 3.25h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H8l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1Z" />),
};
