import { Buffer } from "node:buffer";

const EMPTY_STRING = "";

/**
 * Joins a URL value into the current site-relative path without modification.
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function relative_url(value) {
  return value || EMPTY_STRING;
}

/**
 * Percent-encodes a string for URL usage.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export function url_encode(value) {
  return encodeURIComponent(String(value ?? EMPTY_STRING));
}

/**
 * Decodes a percent-encoded URL component, falling back to the original string on failure.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export function url_decode(value) {
  try {
    return decodeURIComponent(String(value ?? EMPTY_STRING));
  } catch {
    return String(value ?? EMPTY_STRING);
  }
}

/**
 * Encodes a string as UTF-8 base64.
 * @param {string | number | boolean | null | undefined} value
 * @returns {string}
 */
export function base64_encode(value) {
  return Buffer.from(String(value ?? EMPTY_STRING), "utf8").toString("base64");
}
