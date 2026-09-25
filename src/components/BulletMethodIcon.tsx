import { CircleDot, type LucideProps } from "lucide-react";

/** Shared Bullet Method mark, used in the toolbar and settings. */
export function BulletMethodIcon({ size = 24, ...props }: LucideProps) {
  return <CircleDot size={size} aria-hidden="true" focusable="false" {...props} />;
}
