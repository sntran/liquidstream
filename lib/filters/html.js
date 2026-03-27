const EMPTY_STRING = "";

function createHtmlValue(value = EMPTY_STRING) {
  return {
    _h: 1,
    value: String(value),
  };
}

/**
 * Removes HTML tags from a string value.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export function strip_html(value) {
  return String(value ?? EMPTY_STRING).replaceAll(/<[^>]+>/g, EMPTY_STRING);
}

/**
 * Converts newlines to `<br />` and marks the result as HTML-safe.
 * @param {string | number | boolean | null | undefined} value
 * @returns {{ _h: number, value: string }}
 */
export function newline_to_br(value) {
  return createHtmlValue(String(value ?? EMPTY_STRING).replaceAll("\n", "<br />"));
}

/**
 * Marks a value as HTML-safe so it bypasses auto-escaping.
 * @param {string | number | boolean | null | undefined} value
 * @returns {{ _h: number, value: string }}
 */
export function raw(value) {
  return createHtmlValue(value);
}
