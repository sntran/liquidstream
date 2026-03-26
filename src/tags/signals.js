function createSignal(action, payload = {}) {
  return {
    action,
    ...payload,
  };
}

export function CONTINUE(payload = {}) {
  return createSignal("CONTINUE", payload);
}

export function OUTPUT(output, payload = {}) {
  return createSignal("OUTPUT", {
    output,
    html: Boolean(payload.html),
    ...payload,
  });
}

export function SKIP(payload = {}) {
  return createSignal("SKIP", {
    state: "SKIP",
    ...payload,
  });
}

export function CAPTURE(payload = {}) {
  return createSignal("CAPTURE", {
    state: "CAPTURE",
    ...payload,
  });
}

export function RAW(payload = {}) {
  return createSignal("RAW", {
    state: "RAW",
    ...payload,
  });
}

export function NEST(payload = {}) {
  return createSignal("NEST", {
    deltaSkipDepth: 1,
    ...payload,
  });
}

export function UNNEST(payload = {}) {
  return createSignal("UNNEST", {
    deltaSkipDepth: -1,
    ...payload,
  });
}

export function RESUME_EMIT(payload = {}) {
  return createSignal("RESUME_EMIT", {
    state: "EMIT",
    ...payload,
  });
}

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

export function applySignal(signal, handler) {
  if (!signal || !handler) {
    return handler;
  }

  if (signal.ifStackPush) {
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
