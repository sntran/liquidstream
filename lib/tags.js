import { caseTag, elseTag, elsif, endcase, endif, ifTag, unless, when } from "./tags/flow.js";
import { include, render } from "./tags/file.js";
import { endfor, forTag } from "./tags/iteration.js";
import { endraw, raw } from "./tags/raw.js";
import { assign, capture, decrement, endcapture, increment } from "./tags/variable.js";

export const coreTags = {
  assign,
  capture,
  case: caseTag,
  decrement,
  else: elseTag,
  elsif,
  endcapture,
  endcase,
  endif,
  endfor,
  endraw,
  for: forTag,
  if: ifTag,
  include,
  increment,
  raw,
  render,
  unless,
  when,
};

export {
  assign,
  capture,
  caseTag,
  decrement,
  elseTag,
  elsif,
  endcapture,
  endcase,
  endif,
  endfor,
  endraw,
  forTag,
  ifTag,
  include,
  increment,
  raw,
  render,
  unless,
  when,
};
