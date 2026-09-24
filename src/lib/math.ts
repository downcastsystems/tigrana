import katex from "katex";

export const mathSizes = [
  { value: "tiny", label: "Tiny" },
  { value: "scriptsize", label: "Extra small" },
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "Large", label: "Extra large" },
  { value: "huge", label: "Huge" },
] as const;
export type MathSize = typeof mathSizes[number]["value"];

// Recognize only a size group enclosing the entire formula, not one term.
export function splitMathSize(source: string): { latex: string; size: MathSize } {
  const latex = source.trim();
  const match = /^\{\\(tiny|scriptsize|small|large|Large|huge)\s+/.exec(latex);
  if (match && latex.endsWith("}")) {
    let depth = 0;
    for (let index = 0; index < latex.length; index++) {
      if (latex[index] === "\\") { index++; continue; }
      if (latex[index] === "{") depth++;
      if (latex[index] === "}") depth--;
      if (depth === 0) {
        if (index === latex.length - 1) return { latex: latex.slice(match[0].length, -1).trim(), size: match[1] as MathSize };
        break;
      }
    }
  }
  return { latex: source, size: "normal" };
}

export function withMathSize(latex: string, size: MathSize): string {
  return size === "normal" ? latex : `{\\${size} ${latex} }`;
}

export const mathExamples = [
  { label: "Fraction", latex: String.raw`\frac{1}{2} + \frac{1}{2} = 1`, explanation: "The braces hold the top and bottom of each fraction." },
  { label: "Percentage", latex: String.raw`\frac{25}{100} \times 100\% = 25\%`, explanation: "Use \\times for multiplication and \\% for a percent sign." },
  { label: "Powers", latex: "x^2 + y^2 = z^2", explanation: "A caret raises the next number. Use braces for longer powers: x^{10}." },
  { label: "Square root", latex: String.raw`\sqrt{16} = 4`, explanation: "Put what goes under the square root inside the braces." },
  { label: "Subscripts", latex: "a_1 + a_2 + a_3", explanation: "An underscore lowers the next number. Use braces for longer subscripts: a_{12}." },
  { label: "Words", latex: String.raw`\text{Total} = \text{Price} \times \text{Quantity}`, explanation: "Use \\text{...} for ordinary words inside an equation." },
];

export function renderMath(latex: string, displayMode: boolean, output: "htmlAndMathml" | "mathml" = "htmlAndMathml") {
  if (latex.length > 10000) throw new Error("This equation is too long. Split it into smaller equations.");
  return katex.renderToString(latex, {
    displayMode, output, trust: false, throwOnError: true,
    maxExpand: 1000, maxSize: 20, strict: "ignore",
  });
}

export function mathMarkdown(latex: string, block: boolean) {
  return block ? `$$\n${latex}\n$$` : `$${latex}$`;
}

export type MathExample = { label: string; latex: string; explanation: string; block?: boolean };
export const moreMathExamples: Array<{ label: string; examples: MathExample[] }> = [
  { label: "Algebra and geometry", examples: [
    { label: "Quadratic formula", latex: String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`, explanation: "Solves ax² + bx + c = 0, where a is not zero." },
    { label: "Pythagorean theorem", latex: "a^2 + b^2 = c^2", explanation: "For a right triangle, c is the hypotenuse and a and b are the other sides." },
    { label: "Area of a circle", latex: String.raw`A = \pi r^2`, explanation: "The area of a circle with radius r." },
    { label: "Euler’s identity", latex: String.raw`e^{i\pi} + 1 = 0`, explanation: "Connects e, the imaginary unit i, pi, one, and zero." },
  ] },
  { label: "Calculus", examples: [
    { label: "Power rule", latex: String.raw`\frac{d}{dx}x^n = nx^{n-1}`, explanation: "The derivative of x raised to a constant power, wherever the expression is differentiable." },
    { label: "Definite integral", latex: String.raw`\int_a^b f(x)\,dx = F(b) - F(a), \qquad F'(x) = f(x)`, explanation: "For continuous f, an antiderivative F evaluates the integral between a and b." },
  ] },
  { label: "Probability and statistics", examples: [
    { label: "Bayes’ theorem", latex: String.raw`P(A\mid B) = \frac{P(B\mid A)P(A)}{P(B)}, \qquad P(B)>0`, explanation: "Updates the probability of A given evidence B." },
    { label: "Normal distribution", latex: String.raw`f(x) = \frac{1}{\sigma\sqrt{2\pi}}\exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right), \qquad \sigma>0`, explanation: "The bell-shaped probability density with mean mu and standard deviation sigma." },
  ] },
  { label: "Physics", examples: [
    { label: "Newton’s second law", latex: String.raw`\mathbf{F}_{\mathrm{net}} = m\mathbf{a}`, explanation: "For constant mass, net force equals mass times acceleration." },
    { label: "Mass–energy equivalence", latex: "E_0 = mc^2", explanation: "Rest energy equals mass times the speed of light squared." },
  ] },
  { label: "Advanced", examples: [
    { label: "Heat equation on a rod", block: true, latex: String.raw`\begin{aligned}
\frac{\partial u}{\partial t}
&= \alpha \frac{\partial^2 u}{\partial x^2},
&& 0 < x < L,\quad t > 0 \\[6pt]
u(0,t) &= u(L,t) = 0,
&& u(x,0) = f(x) \\[8pt]
u(x,t)
&= \sum_{n=1}^{\infty}
\left[
\frac{2}{L}
\int_0^L f(\xi)
\sin\left(\frac{n\pi\xi}{L}\right)\,d\xi
\right]
e^{-\alpha\left(\frac{n\pi}{L}\right)^2t}
\sin\left(\frac{n\pi x}{L}\right)
\end{aligned}`, explanation: "Heat diffusion along a rod of length L, with ends held at zero temperature and initial temperature f(x). Alpha is the positive thermal diffusivity. The last line gives the temperature as a sum of decaying waves." },
  ] },
];
