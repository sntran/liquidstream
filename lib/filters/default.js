const EMPTY_STRING = "";

function defaultFilter(value, fallback = EMPTY_STRING) {
  return value === undefined || value === null || value === EMPTY_STRING || value === false ? fallback : value;
}

/**
 * Returns the fallback when the input is nullish, false, or an empty string.
 * @param {unknown} value
 * @param {unknown} [fallback=""]
 * @returns {unknown}
 */
export { defaultFilter as default };
