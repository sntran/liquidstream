import { Buffer } from "node:buffer";

const EMPTY_STRING = "";

export function relative_url(value) {
  return value || EMPTY_STRING;
}

export function url_encode(value) {
  return encodeURIComponent(String(value ?? EMPTY_STRING));
}

export function url_decode(value) {
  try {
    return decodeURIComponent(String(value ?? EMPTY_STRING));
  } catch {
    return String(value ?? EMPTY_STRING);
  }
}

export function base64_encode(value) {
  return Buffer.from(String(value ?? EMPTY_STRING), "utf8").toString("base64");
}
