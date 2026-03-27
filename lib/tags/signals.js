function createSignal(action, payload = {}) {
  return {
    action,
    ...payload,
  };
}

/**
 * Creates a no-op continuation signal.
 * @param {object} [payload={}]
 * @returns {object}
 */
export function CONTINUE(payload = {}) {
  return createSignal("CONTINUE", payload);
}

/**
 * Creates an output signal with optional HTML-safe metadata.
 * @param {unknown} output
 * @param {object} [payload={}]
 * @returns {object}
 */
export function OUTPUT(output, payload = {}) {
  return createSignal("OUTPUT", {
    output,
    html: Boolean(payload.html),
    ...payload,
  });
}

/**
 * Creates a signal that moves the handler into skip mode.
 * @param {object} [payload={}]
 * @returns {object}
 */
export function SKIP(payload = {}) {
  return createSignal("SKIP", {
    state: "SKIP",
    ...payload,
  });
}

/**
 * Creates a signal that moves the handler into capture mode.
 * @param {object} [payload={}]
 * @returns {object}
 */
export function CAPTURE(payload = {}) {
  return createSignal("CAPTURE", {
    state: "CAPTURE",
    ...payload,
  });
}

/**
 * Creates a signal that moves the handler into raw mode.
 * @param {object} [payload={}]
 * @returns {object}
 */
export function RAW(payload = {}) {
  return createSignal("RAW", {
    state: "RAW",
    ...payload,
  });
}

/**
 * Creates a signal that increases skip nesting depth.
 * @param {object} [payload={}]
 * @returns {object}
 */
export function NEST(payload = {}) {
  return createSignal("NEST", {
    deltaSkipDepth: 1,
    ...payload,
  });
}

/**
 * Creates a signal that decreases skip nesting depth.
 * @param {object} [payload={}]
 * @returns {object}
 */
export function UNNEST(payload = {}) {
  return createSignal("UNNEST", {
    deltaSkipDepth: -1,
    ...payload,
  });
}

/**
 * Creates a signal that resumes normal emit mode.
 * @param {object} [payload={}]
 * @returns {object}
 */
export function RESUME_EMIT(payload = {}) {
  return createSignal("RESUME_EMIT", {
    state: "EMIT",
    ...payload,
  });
}

/**
 * Creates a signal that breaks out of the current processing branch.
 * @param {object} [payload={}]
 * @returns {object}
 */
export function BREAK(payload = {}) {
  return createSignal("BREAK", payload);
}

function applyDefined(handler, signal, keys) {
  for (const key of keys) {
    if (key in signal) {
      handler[key] = signal[key];
    }
  }
}

/**
 * Applies a control signal to the mutable handler state.
 * @param {object} signal
 * @param {object} handler
 * @returns {object}
 */
export function applySignal(signal, handler) {
  if (!signal || !handler) {
    return handler;
  }

  if (signal.ifStackPush) {
    // Signals may push one frame or a batch of frames depending on the tag transition.
    const frames = Array.isArray(signal.ifStackPush) ? signal.ifStackPush : [signal.ifStackPush];
    handler.ifStack.push(...frames);
  }

  if (signal.ifStackPop) {
    const count = Math.max(0, Number(signal.ifStackPop) || 0);
    for (let index = 0; index < count; index += 1) {
      handler.ifStack.pop();
    }
  }

  if ("deltaSkipDepth" in signal) {
    handler.skipDepth = Math.max(0, handler.skipDepth + signal.deltaSkipDepth);
  }

  if ("state" in signal) {
    handler.state = signal.state;
  }

  // Apply the remaining direct state overrides after structural stack mutations.
  applyDefined(handler, signal, [
    "currentContext",
    "skipDepth",
    "skipMode",
    "capture",
    "raw",
    "runtime",
    "renderDepth",
    "textBufferParts",
    "inLiquidTag",
  ]);

  return handler;
}
