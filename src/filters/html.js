const EMPTY_STRING = "";

function createHtmlValue(value = EMPTY_STRING) {
  return {
    _h: 1,
    value: String(value),
  };
}

export function strip_html(value) {
  return String(value ?? EMPTY_STRING).replaceAll(/<[^>]+>/g, EMPTY_STRING);
}

export function newline_to_br(value) {
  return createHtmlValue(String(value ?? EMPTY_STRING).replaceAll("\n", "<br />"));
}

export function raw(value) {
  return createHtmlValue(value);
}
