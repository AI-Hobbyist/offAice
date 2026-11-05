import type { SVGProps } from 'react';

/** Two interlocking connectors, drawn on the same 24px grid as the workbench icons. */
export function McpIcon({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="m8 15-2.1-2.1a3 3 0 0 1 0-4.2l4.8-4.8a3 3 0 0 1 4.2 0L17 6" />
      <path d="m7 18 2.1 2.1a3 3 0 0 0 4.2 0l4.8-4.8a3 3 0 0 0 0-4.2L16 9" />
      <path d="m8.5 12 5-5M10.5 17l5-5M3 19l3-3M18 8l3-3" />
    </svg>
  );
}
