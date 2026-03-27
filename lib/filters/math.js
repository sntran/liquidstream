function toNumber(value) {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : number;
}

function mathMethod(methodName) {
  return (value) => Math[methodName](toNumber(value));
}

/**
 * Returns the absolute numeric value.
 * @param {string | number | boolean | null | undefined} value
 * @returns {number}
 */
export const abs = mathMethod("abs");

/**
 * Clamps a number to a minimum value.
 * @param {string | number | boolean | null | undefined} value
 * @param {string | number | boolean | null | undefined} minimum
 * @returns {number}
 */
export function at_least(value, minimum) {
  return Math.max(toNumber(value), toNumber(minimum));
}

/**
 * Clamps a number to a maximum value.
 * @param {string | number | boolean | null | undefined} value
 * @param {string | number | boolean | null | undefined} maximum
 * @returns {number}
 */
export function at_most(value, maximum) {
  return Math.min(toNumber(value), toNumber(maximum));
}

/**
 * Rounds a number up to the nearest integer.
 * @param {string | number | boolean | null | undefined} value
 * @returns {number}
 */
export const ceil = mathMethod("ceil");

/**
 * Rounds a number down to the nearest integer.
 * @param {string | number | boolean | null | undefined} value
 * @returns {number}
 */
export const floor = mathMethod("floor");

/**
 * Rounds a number to the provided precision.
 * @param {string | number | boolean | null | undefined} value
 * @param {number | string} [precision=0]
 * @returns {number}
 */
export function round(value, precision = 0) {
  const number = toNumber(value);
  const digits = Number(precision);
  if (Number.isNaN(digits)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

/**
 * Divides by the provided divisor using Liquid-style integer truncation for integer divisors.
 * @param {string | number | boolean | null | undefined} value
 * @param {string | number | boolean | null | undefined} divisor
 * @returns {number}
 */
export function divided_by(value, divisor) {
  const number = toNumber(value);
  const denominator = Number(divisor);
  if (Number.isNaN(denominator) || denominator === 0) {
    return 0;
  }

  return Number.isInteger(denominator) ? Math.trunc(number / denominator) : number / denominator;
}

/**
 * Subtracts an amount from the input value.
 * @param {string | number | boolean | null | undefined} value
 * @param {string | number | boolean | null | undefined} [amount=0]
 * @returns {number}
 */
export function minus(value, amount = 0) {
  return toNumber(value) - toNumber(amount);
}

/**
 * Truncates the fractional portion of a number.
 * @param {string | number | boolean | null | undefined} value
 * @returns {number}
 */
export const trunc = mathMethod("trunc");

/**
 * Returns the square root of a number.
 * @param {string | number | boolean | null | undefined} value
 * @returns {number}
 */
export const sqrt = mathMethod("sqrt");

/**
 * Returns the sign of a number.
 * @param {string | number | boolean | null | undefined} value
 * @returns {number}
 */
export const sign = mathMethod("sign");
