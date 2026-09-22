import { generate, parse, walk, type Rule, type SelectorList } from "css-tree";
import type { ThemeDesign } from "./themeDesign";

const functions = new Set([
  "var",
  "calc",
  "min",
  "max",
  "clamp",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeat",
  "minmax",
  "fit-content",
  "translate",
  "translatex",
  "translatey",
  "scale",
  "rotate",
  "cubic-bezier",
]);
const pseudos = new Set([
  "scope",
  "hover",
  "active",
  "focus",
  "focus-visible",
  "focus-within",
  "disabled",
  "enabled",
  "checked",
  "first-child",
  "last-child",
  "empty",
]);
/** Compile a bounded stylesheet into a theme region. Never insert source CSS directly. */
export function compileThemeCss(design: ThemeDesign, region: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(region))
    throw new Error("Invalid theme region.");
  if (design.css.length > 100_000) throw new Error("Theme CSS exceeds 100 KB.");
  const ast = parse(design.css, {
    parseCustomProperty: true,
    positions: true,
    onParseError: (e) => {
      throw e;
    },
  });
  const scope = `[data-theme-region="${region}"]`;
  let nodes = 0;
  let resourceBytes = Object.values(design.assets)
    .filter((a) => a.mime === "font/woff2")
    .reduce((n, a) => n + a.data.length, 0);
  const rules: Rule[] = [];
  const fonts = new Map<string, string>();
  for (const [path, asset] of Object.entries(design.assets)) {
    if (asset.mime === "font/woff2")
      fonts.set(
        `theme-font-${path.slice(7, -6)}`,
        `tigrana-${region}-${path.slice(7, -6)}`,
      );
  }
  walk(ast, (node) => {
    if (++nodes > 12_000) throw new Error("Theme CSS is too complex.");
    if (node.type === "Raw") throw new Error("Unsupported or malformed CSS.");
    if (node.type === "Atrule" && (node.name !== "media" || !node.block))
      throw new Error("Only @media blocks are supported in theme CSS.");
    if (node.type === "Rule") {
      if (!node.prelude || node.prelude.type !== "SelectorList")
        throw new Error("Invalid theme selector.");
      node.block.children.forEach((child) => {
        if (child.type !== "Declaration")
          throw new Error(
            "Nested CSS rules are not supported. Use complete selectors.",
          );
      });
      rules.push(node);
    }
    if (node.type === "Combinator" && ![" ", ">"].includes(node.name))
      throw new Error(
        "Use descendant or child selectors within a theme region.",
      );
    if (
      node.type === "PseudoClassSelector" &&
      (!pseudos.has(node.name) || node.children)
    )
      throw new Error(`Unsupported pseudo-class: ${node.name}`);
    if (
      node.type === "PseudoElementSelector" &&
      !["before", "after", "marker", "selection", "placeholder"].includes(
        node.name,
      )
    )
      throw new Error("Unsupported pseudo-element.");
    if (node.type === "Declaration") {
      const prop = node.property.toLowerCase();
      if (
        prop.includes("\\") ||
        (prop.startsWith("--") && !/^--tigrana-[a-z0-9-]+$/.test(prop))
      )
        throw new Error("Theme variables must start with --tigrana-.");
      if (
        /^(animation|transition|behavior|binding|cursor|filter|backdrop-filter)/.test(
          prop.replace(/^-(webkit|moz|ms|o)-/, ""),
        )
      )
        throw new Error(`The theme API does not support ${prop}.`);
      // Scoped rules already outrank base component rules. Never compete with recovery UI.
      if (node.important) throw new Error("Theme CSS must not use !important.");
    }
    if (node.type === "Function" && !functions.has(node.name.toLowerCase()))
      throw new Error(`Unsupported CSS function: ${node.name}`);
    if (node.type === "Url") {
      const asset = design.assets[node.value];
      if (!asset || !asset.mime.startsWith("image/"))
        throw new Error(
          "CSS URLs must refer to packaged raster images, e.g. assets/paper.png.",
        );
      resourceBytes += asset.data.length;
      if (resourceBytes > 8 * 1024 * 1024)
        throw new Error(
          "Expanded theme CSS exceeds 8 MB. Reuse fewer asset references.",
        );
      node.value = `data:${asset.mime};base64,${asset.data}`;
    }
    if (node.type === "Identifier" && fonts.has(node.name))
      node.name = fonts.get(node.name)!;
  });
  for (const rule of rules) {
    const selectors = (rule.prelude as SelectorList).children.toArray();
    const scoped = selectors
      .map((selector) => {
        let hasScope = false;
        walk(selector, (node) => {
          if (node.type === "PseudoClassSelector" && node.name === "scope")
            hasScope = true;
        });
        const text = generate(selector);
        if (hasScope && !text.startsWith(":scope"))
          throw new Error(":scope must be the first part of a selector.");
        if (hasScope && (text.match(/:scope/g)?.length ?? 0) !== 1)
          throw new Error("Use :scope only once per selector.");
        if (hasScope) return text.replace(/^:scope/, scope);
        const first =
          selector.type === "Selector" ? selector.children.first : null;
        const rootSelector =
          first?.type === "TypeSelector"
            ? `${first.name}${scope}${text.slice(first.name.length)}`
            : `${scope}${text}`;
        return `${scope} ${text},${rootSelector}`;
      })
      .join(",");
    rule.prelude = parse(scoped, { context: "selectorList" }) as SelectorList;
  }
  const fontCss = [...fonts]
    .map(([alias, family]) => {
      const a = design.assets[`assets/${alias.slice(11)}.woff2`];
      return `@font-face{font-family:"${family}";src:url("data:font/woff2;base64,${a.data}") format("woff2");font-display:swap;}`;
    })
    .join("");
  const result = fontCss + generate(ast);
  if (result.length > 8 * 1024 * 1024)
    throw new Error("Expanded theme CSS exceeds 8 MB.");
  return result;
}
