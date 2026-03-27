const EMPTY_STRING = "";

/**
 * Returns the length of an array or string input.
 * @param {string | unknown[] | null | undefined} value
 * @returns {number}
 */
export function size(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return value.length;
  }

  return 0;
}

/**
 * Slices an array or string using Liquid-style numeric arguments.
 * @param {unknown[] | string | number | boolean | null | undefined} value
 * @param {number | string} [start=0]
 * @param {number | string} [length]
 * @returns {unknown[] | string}
 */
export function slice(value, start = 0, length) {
  const startIndex = Number(start) || 0;
  const endIndex = length === undefined ? undefined : startIndex + Number(length);

  if (Array.isArray(value)) {
    return value.slice(startIndex, endIndex);
  }

  const string = String(value ?? EMPTY_STRING);
  return string.slice(startIndex, endIndex);
}

/**
 * Joins array items with the provided delimiter.
 * @param {unknown[] | null | undefined} value
 * @param {string} [delimiter=" "]
 * @returns {string}
 */
export function join(value, delimiter = " ") {
  return Array.isArray(value) ? value.join(String(delimiter)) : EMPTY_STRING;
}

/**
 * Projects a property from each item in an array.
 * @param {Array<Record<string, unknown> | null | undefined> | null | undefined} value
 * @param {string} property
 * @returns {unknown[]}
 */
export function map(value, property) {
  return Array.isArray(value) ? value.map((item) => item?.[property]) : [];
}

/**
 * Returns the first item from an array or string.
 * @param {string | unknown[] | null | undefined} value
 * @returns {unknown}
 */
export function first(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return value[0] ?? EMPTY_STRING;
  }

  return EMPTY_STRING;
}

/**
 * Returns the last item from an array or string.
 * @param {string | unknown[] | null | undefined} value
 * @returns {unknown}
 */
export function last(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return value.length ? value[value.length - 1] : EMPTY_STRING;
  }

  return EMPTY_STRING;
}

/**
 * Returns a shallow-sorted copy of an array, optionally by property.
 * @param {unknown[] | null | undefined} value
 * @param {string} [property]
 * @returns {unknown[]}
 */
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
