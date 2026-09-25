import type { SVGProps } from "react";

/** Shared Bullet Method mark: a solid bullet beside a downward arrow. */
export function BulletMethodIcon({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      aria-hidden="true" focusable="false" {...props}>
      <circle cx="5" cy="12" r="3.3" fill="currentColor" />
      <path d="M16 5v14m-4-4 4 4 4-4" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
