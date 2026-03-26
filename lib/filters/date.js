const EMPTY_STRING = "";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TOKENS = /%[YmdHMSLsbBaA]/g;
const DATE_FORMATTERS = {
  "%b": new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }),
  "%B": new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }),
  "%a": new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }),
  "%A": new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }),
};

function parseDateValue(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "now") {
      return new Date();
    }

    const normalized = DATE_ONLY_PATTERN.test(trimmed)
      ? `${trimmed}T00:00:00Z`
      : trimmed;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function date(value, format = "%Y-%m-%d") {
  const date = parseDateValue(value);
  if (!date) {
    return EMPTY_STRING;
  }

  const pad = (number) => String(number).padStart(2, "0");
  const padMilliseconds = (number) => String(number).padStart(3, "0");
  return String(format).replace(DATE_TOKENS, (token) => {
    switch (token) {
      case "%Y":
        return String(date.getUTCFullYear());
      case "%m":
        return pad(date.getUTCMonth() + 1);
      case "%d":
        return pad(date.getUTCDate());
      case "%H":
        return pad(date.getUTCHours());
      case "%M":
        return pad(date.getUTCMinutes());
      case "%S":
        return pad(date.getUTCSeconds());
      case "%L":
        return padMilliseconds(date.getUTCMilliseconds());
      case "%s":
        return String(Math.floor(date.getTime() / 1000));
      default:
        return DATE_FORMATTERS[token]?.format(date) || token;
    }
  });
}
