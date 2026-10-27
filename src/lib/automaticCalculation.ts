// Bound both parsing work and the editor's look-behind, regardless of Note size.
export const calculationMaxLength = 256;

/** Evaluate arithmetic only, never JavaScript or a partial match inside prose. */
export function calculateExpression(source: string): string | null {
  if (source.length > calculationMaxLength) return null;
  let expression = source.trim();
  // An optional label makes inline totals explicit: "Total: 1 + 2".
  expression = expression.replace(/^[\p{L}][\p{L}\p{N} _-]*:[ \t]*/u, "");
  if (!expression) return null;
  const tokens: Array<string | number> = [];
  let currency = false;
  for (let index = 0; index < expression.length;) {
    const char = expression[index];
    if (/\s/.test(char)) { index++; continue; }
    if ("+-*/^()%×÷−".includes(char)) { tokens.push(char); index++; continue; }
    if (char === "$") { currency = true; index++; }
    const match = /^(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)/.exec(expression.slice(index));
    if (!match) return null;
    tokens.push(Number(match[0].replace(/,/g, "")));
    index += match[0].length;
  }

  let position = 0;
  let operations = 0;
  function primary(): number {
    const token = tokens[position++];
    let value: number;
    if (typeof token === "number") value = token;
    else if (token === "(") {
      value = sum();
      if (tokens[position++] !== ")") return NaN;
    } else return NaN;
    if (tokens[position] === "%") { position++; value /= 100; operations++; }
    return value;
  }
  function power(): number {
    const value = primary();
    if (tokens[position] !== "^") return value;
    position++; operations++;
    return value ** unary();
  }
  function unary(): number {
    const token = tokens[position];
    if (token !== "+" && token !== "-" && token !== "−") return power();
    position++;
    return (token === "+" ? 1 : -1) * unary();
  }
  function product(): number {
    let value = unary();
    while (["*", "/", "×", "÷"].includes(String(tokens[position]))) {
      const operator = tokens[position++]; operations++;
      const right = unary();
      value = operator === "*" || operator === "×" ? value * right : value / right;
    }
    return value;
  }
  function sum(): number {
    let value = product();
    while (["+", "-", "−"].includes(String(tokens[position]))) {
      const operator = tokens[position++]; operations++;
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  const value = sum();
  if (position !== tokens.length || operations === 0 || !Number.isFinite(value)) return null;
  // Hide binary floating-point noise without giving ordinary numbers cents.
  const rounded = Number.isInteger(value) ? value : Number(value.toPrecision(15));
  if (!currency) return String(rounded);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(rounded);
}
