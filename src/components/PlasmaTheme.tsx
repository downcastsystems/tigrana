import { lazy, Suspense } from "react";

const PlasmaMaterial = lazy(() => import("./PlasmaMaterial"));

export default function PlasmaTheme(props: { theme: "light" | "dark"; frost: number; flow?: number; backgroundBlur: number; backgroundImage?: string; accentColor: string; layoutKey: string; preview?: boolean }) {
  return <Suspense fallback={null}><PlasmaMaterial {...props} /></Suspense>;
}
