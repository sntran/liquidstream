import { createRawState } from "../utils.js";
import { CONTINUE, RAW } from "./signals.js";

/** Core `raw` tag definition. */
export const raw = {
  name: "raw",
  onEmit() {
    return RAW({
      raw: createRawState(),
    });
  },
  onSkip() {
    return null;
  },
};

/** Core `endraw` tag definition. */
export const endraw = {
  name: "endraw",
  onEmit() {
    return CONTINUE();
  },
  onSkip() {
    return null;
  },
};
