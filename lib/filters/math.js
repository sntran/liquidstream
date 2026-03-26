function toNumber(value) {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : number;
}

function mathMethod(methodName) {
  return (value) => Math[methodName](toNumber(value));
}

export const abs = mathMethod("abs");

export function at_least(value, minimum) {
  return Math.max(toNumber(value), toNumber(minimum));
}

export function at_most(value, maximum) {
  return Math.min(toNumber(value), toNumber(maximum));
}

export const ceil = mathMethod("ceil");

export const floor = mathMethod("floor");

export function round(value, precision = 0) {
  const number = toNumber(value);
  const digits = Number(precision);
  if (Number.isNaN(digits)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

export function divided_by(value, divisor) {
  const number = toNumber(value);
  const denominator = Number(divisor);
  if (Number.isNaN(denominator) || denominator === 0) {
    return 0;
  }

  return Number.isInteger(denominator) ? Math.trunc(number / denominator) : number / denominator;
}

export function minus(value, amount = 0) {
  return toNumber(value) - toNumber(amount);
}

export const trunc = mathMethod("trunc");

export const sqrt = mathMethod("sqrt");

export const sign = mathMethod("sign");
