import { useMemo } from 'react';
import { checkTheme } from '../lib/themeHealth';
import type { ThemeDocument } from '../lib/themes';
export function ThemeHealthCheck({ theme }: { theme: ThemeDocument }) {
  const result = useMemo(() => checkTheme(theme), [theme]);
  return <details className="theme-health" open={result.errors.length > 0 || undefined}>
    <summary>Theme check: {result.errors.length ? 'needs correction' : result.warnings.length ? `${result.warnings.length} things to review` : 'passed'}</summary>
    <p>Checks both color modes. Warnings are advice; colors are never changed automatically.</p>
    {result.errors.map(error => <p role="alert" key={error}>{error}</p>)}
    <ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
  </details>;
}
