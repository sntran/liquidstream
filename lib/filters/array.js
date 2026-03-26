const EMPTY_STRING = "";

export function size(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return value.length;
  }

  return 0;
}

export function slice(value, start = 0, length) {
  const startIndex = Number(start) || 0;
  const endIndex = length === undefined ? undefined : startIndex + Number(length);

  if (Array.isArray(value)) {
    return value.slice(startIndex, endIndex);
  }

  const string = String(value ?? EMPTY_STRING);
  return string.slice(startIndex, endIndex);
}

export function join(value, delimiter = " ") {
  return Array.isArray(value) ? value.join(String(delimiter)) : EMPTY_STRING;
}

export function map(value, property) {
  return Array.isArray(value) ? value.map((item) => item?.[property]) : [];
}

export function first(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return value[0] ?? EMPTY_STRING;
  }

  return EMPTY_STRING;
}

export function last(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return value.length ? value[value.length - 1] : EMPTY_STRING;
  }

  return EMPTY_STRING;
}

export function sort(value, property) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...value].sort((left, right) => {
    const leftValue = property ? left?.[property] : left;
    const rightValue = property ? right?.[property] : right;

    if (leftValue === rightValue) {
      return 0;
    }

    if (leftValue === undefined || leftValue === null) {
      return 1;
    }

    if (rightValue === undefined || rightValue === null) {
      return -1;
    }

    return leftValue < rightValue ? -1 : 1;
  });
}
