import { expect, it } from "vitest";
import { calculateExpression, calculationMaxLength } from "./automaticCalculation";

it.each([
  ["1 + 2", "3"], ["1+2*3", "7"], ["(1 + 2) * 3", "9"],
  ["10 / 4", "2.5"], ["1 − 4", "-3"], ["6 × 4 ÷ 3", "8"],
  ["-2^2", "-4"], ["2^3^2", "512"], ["2^-2", "0.25"],
  ["0.1 + 0.2", "0.3"], [".5 + .25", "0.75"], ["1,000 + 2", "1002"],
  ["123456789012345 + 1", "123456789012346"],
  ["200 * 10%", "20"], ["50%", "0.5"], ["  Total: 1 + 2 ", "3"],
  ["$1 + 2", "$3.00"], ["1 + $2", "$3.00"], ["$1 + $2", "$3.00"],
  ["$1 - $2", "-$1.00"], ["$1,200 / 2", "$600.00"], ["$0.10 + $0.20", "$0.30"],
])("calculates %s as %s", (expression, expected) => {
  expect(calculateExpression(expression)).toBe(expected);
});

it.each([
  "", "1", "-1", "(1)", "a + 2", "Version 1 + 2", "x + 1 + 2",
  "1 +", "1 + 2 =", "1 == 2", "1/0", "0/0", "10^1000", "(1+2", "1+2)",
  "1,00+2", "1 .2 + 3", "1$ + 2", "$ + 2", "10:30+1", "1:2+3",
  "Math: a:1+2", "Math: 1 + <img>", "Math: 1+alert(2)", "1+2\ufffc",
])("leaves ambiguous, incomplete, and invalid expressions alone: %s", expression => {
  expect(calculateExpression(expression)).toBeNull();
});

it("bounds parsing work even for valid expressions", () => {
  expect(calculateExpression("1+".repeat(calculationMaxLength) + "1")).toBeNull();
});
