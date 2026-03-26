const EMPTY_STRING = "";

function defaultFilter(value, fallback = EMPTY_STRING) {
  return value === undefined || value === null || value === EMPTY_STRING || value === false ? fallback : value;
}

export { defaultFilter as default };
