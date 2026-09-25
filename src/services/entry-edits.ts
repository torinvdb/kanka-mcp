import { KankaError } from "../client/errors.js";

export interface EntryEdit {
  before: string;
  after: string;
}

export interface EntryEditResult {
  text: string;
  applied: number;
  changed: boolean;
  nbsp: { before: number; after: number };
  length: { before: number; after: number };
}

const NBSP = " ";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Apply anchored edits to an entry, in order. Every `before` must occur exactly once in
 * the text as it stands when that edit runs, and the U+00A0 count must change by exactly
 * `nbspDelta` (default 0). Anchors and replacements are literal strings: no regex and no
 * `$`-patterns, so text copied from a page is never interpreted. Throws EDIT_REFUSED and
 * leaves the caller to write nothing when any check fails.
 */
export function applyEntryEdits(original: string, edits: readonly EntryEdit[], nbspDelta = 0): EntryEditResult {
  let text = original;
  edits.forEach((edit, index) => {
    if (edit.before.length === 0) {
      throw new KankaError("EDIT_REFUSED", `Edit ${index} has an empty anchor`, {
        details: { reason: "empty_anchor", edit_index: index },
      });
    }
    const occurrences = count(text, edit.before);
    if (occurrences !== 1) {
      throw new KankaError(
        "EDIT_REFUSED",
        `Edit ${index}: anchor occurs ${occurrences} times in the live entry; it must occur exactly once`,
        { details: { reason: "anchor_count", edit_index: index, occurrences } },
      );
    }
    const at = text.indexOf(edit.before);
    text = text.slice(0, at) + edit.after + text.slice(at + edit.before.length);
  });
  const nbspBefore = count(original, NBSP);
  const nbspAfter = count(text, NBSP);
  if (nbspAfter - nbspBefore !== nbspDelta) {
    throw new KankaError(
      "EDIT_REFUSED",
      `U+00A0 count would change from ${nbspBefore} to ${nbspAfter}; expected a change of ${nbspDelta}`,
      { details: { reason: "nbsp_count", before: nbspBefore, after: nbspAfter, expected_delta: nbspDelta } },
    );
  }
  return {
    text,
    applied: edits.length,
    changed: text !== original,
    nbsp: { before: nbspBefore, after: nbspAfter },
    length: { before: original.length, after: text.length },
  };
}
