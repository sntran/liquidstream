const EMPTY_STRING = "";

function toStringValue(value) {
  return String(value ?? EMPTY_STRING);
}

function stringMethod(methodName) {
  return (value, ...argumentsList) => toStringValue(value)[methodName](...argumentsList.map(String));
}

/**
 * Uppercases a string value.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export const upcase = stringMethod("toUpperCase");

/**
 * Lowercases a string value.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export const downcase = stringMethod("toLowerCase");

/**
 * Uppercases the first character of a string value.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export function capitalize(value) {
  const string = toStringValue(value);
  return string ? `${string[0].toUpperCase()}${string.slice(1)}` : EMPTY_STRING;
}

/**
 * Trims leading and trailing whitespace.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export const strip = stringMethod("trim");

/**
 * Splits a string into an array using the provided delimiter.
 * @param {string | null | undefined} value
 * @param {string} [delimiter=" "]
 * @returns {string[]}
 */
export function split(value, delimiter = " ") {
  return typeof value === "string" ? value.split(String(delimiter)) : [];
}

/**
 * Appends a suffix to the input value.
 * @param {string | number | boolean | null | undefined} value
 * @param {string | number | boolean | null | undefined} [suffix=""]
 * @returns {string}
 */
export function append(value, suffix = EMPTY_STRING) {
  return `${value ?? EMPTY_STRING}${suffix ?? EMPTY_STRING}`;
}

/**
 * Replaces all occurrences of a substring.
 * @param {string | number | boolean | null | undefined} value
 * @param {string | number | boolean | null | undefined} [search=""]
 * @param {string | number | boolean | null | undefined} [replacement=""]
 * @returns {string}
 */
export function replace(value, search = EMPTY_STRING, replacement = EMPTY_STRING) {
  return toStringValue(value).split(String(search)).join(String(replacement));
}

/**
 * Trims leading whitespace.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export const trim_start = stringMethod("trimStart");

/**
 * Trims trailing whitespace.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export const trim_end = stringMethod("trimEnd");

/**
 * Checks whether a string starts with the provided prefix.
 * @param {string | number | boolean | null | undefined} value
 * @param {string | number | boolean | null | undefined} prefix
 * @returns {boolean}
 */
export const starts_with = stringMethod("startsWith");

/**
 * Checks whether a string ends with the provided suffix.
 * @param {string | number | boolean | null | undefined} value
 * @param {string | number | boolean | null | undefined} suffix
 * @returns {boolean}
 */
export const ends_with = stringMethod("endsWith");

/**
 * Checks whether a string contains the provided substring.
 * @param {string | number | boolean | null | undefined} value
 * @param {string | number | boolean | null | undefined} substring
 * @returns {boolean}
 */
export const includes = stringMethod("includes");
