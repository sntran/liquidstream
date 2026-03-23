const EMPTY_STRING = "";

function toStringValue(value) {
  return String(value ?? EMPTY_STRING);
}

function stringMethod(methodName) {
  return (value, ...argumentsList) => toStringValue(value)[methodName](...argumentsList.map(String));
}

export const upcase = stringMethod("toUpperCase");

export const downcase = stringMethod("toLowerCase");

export function capitalize(value) {
  const string = toStringValue(value);
  return string ? `${string[0].toUpperCase()}${string.slice(1)}` : EMPTY_STRING;
}

export const strip = stringMethod("trim");

export function split(value, delimiter = " ") {
  return typeof value === "string" ? value.split(String(delimiter)) : [];
}

export function append(value, suffix = EMPTY_STRING) {
  return `${value ?? EMPTY_STRING}${suffix ?? EMPTY_STRING}`;
}

export function replace(value, search = EMPTY_STRING, replacement = EMPTY_STRING) {
  return toStringValue(value).split(String(search)).join(String(replacement));
}

export const trim_start = stringMethod("trimStart");

export const trim_end = stringMethod("trimEnd");

export const starts_with = stringMethod("startsWith");

export const ends_with = stringMethod("endsWith");

export const includes = stringMethod("includes");
