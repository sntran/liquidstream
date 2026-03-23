export function abs(value) {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : Math.abs(number);
}

export function at_least(value, minimum) {
  const current = Number(value);
  const floor = Number(minimum);
  return Number.isNaN(current) || Number.isNaN(floor) ? 0 : Math.max(current, floor);
}

export function at_most(value, maximum) {
  const current = Number(value);
  const ceiling = Number(maximum);
  return Number.isNaN(current) || Number.isNaN(ceiling) ? 0 : Math.min(current, ceiling);
}

export function ceil(value) {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : Math.ceil(number);
}

export function floor(value) {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : Math.floor(number);
}

export function round(value, precision = 0) {
  const number = Number(value);
  const digits = Number(precision);
  if (Number.isNaN(number) || Number.isNaN(digits)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

export function divided_by(value, divisor) {
  const number = Number(value);
  const denominator = Number(divisor);
  if (Number.isNaN(number) || Number.isNaN(denominator) || denominator === 0) {
    return 0;
  }

  return Number.isInteger(denominator) ? Math.trunc(number / denominator) : number / denominator;
}

export function minus(value, amount = 0) {
  const number = Number(value);
  const delta = Number(amount);
  if (Number.isNaN(number) || Number.isNaN(delta)) {
    return 0;
  }

  return number - delta;
}
