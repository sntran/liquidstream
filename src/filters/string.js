const EMPTY_STRING = "";

export function upcase(value) {
  return String(value ?? EMPTY_STRING).toUpperCase();
}

export function downcase(value) {
  return String(value ?? EMPTY_STRING).toLowerCase();
}

export function capitalize(value) {
  const string = String(value ?? EMPTY_STRING);
  return string ? `${string[0].toUpperCase()}${string.slice(1)}` : EMPTY_STRING;
}

export function strip(value) {
  return String(value ?? EMPTY_STRING).trim();
}

export function split(value, delimiter = " ") {
  return typeof value === "string" ? value.split(String(delimiter)) : [];
}

export function append(value, suffix = EMPTY_STRING) {
  return `${value ?? EMPTY_STRING}${suffix ?? EMPTY_STRING}`;
}

export function replace(value, search = EMPTY_STRING, replacement = EMPTY_STRING) {
  return String(value ?? EMPTY_STRING).split(String(search)).join(String(replacement));
}
