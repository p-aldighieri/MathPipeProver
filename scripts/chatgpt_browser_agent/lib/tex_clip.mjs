// tex_clip.mjs — strip harvest junk from a LaTeX document captured out of an
// LLM/browser response.
//
// Why this exists: when a `.tex` is harvested from a chat code block, the model
// often emits the full document and then keeps talking (e.g. "Notes: ...",
// "G. appendix.tex patch", a closing ``` fence, or a "Here is the file:"
// preamble). LaTeX silently ignores anything before \documentclass and after
// \end{document}, so the PDF still builds and the pollution goes unnoticed — but
// it corrupts the submission source. Clip to exactly the document.
//
// Conservative by design: if the text is not recognizably a LaTeX document
// (no \documentclass, or no \end{document}), it is returned UNCHANGED. Never
// touches anything between \documentclass and \end{document}.

export function clipLatexDocument(text) {
  if (typeof text !== 'string' || !text) return text;
  const start = text.indexOf('\\documentclass');
  if (start < 0) return text; // not a standalone LaTeX doc — leave alone
  const endMarker = '\\end{document}';
  const endIdx = text.indexOf(endMarker, start);
  if (endIdx < 0) return text; // no closing — incomplete; don't guess
  const clipped = text.slice(start, endIdx + endMarker.length);
  return clipped.endsWith('\n') ? clipped : clipped + '\n';
}

// Returns {clipped, removedBefore, removedAfter} for callers that want to report
// what was stripped (line counts of non-document material).
export function clipLatexDocumentVerbose(text) {
  const clipped = clipLatexDocument(text);
  if (clipped === text) return { clipped, removedBefore: 0, removedAfter: 0 };
  const start = text.indexOf('\\documentclass');
  const endIdx = text.indexOf('\\end{document}', start) + '\\end{document}'.length;
  const before = text.slice(0, start).trim();
  const after = text.slice(endIdx).trim();
  return {
    clipped,
    removedBefore: before ? before.split('\n').length : 0,
    removedAfter: after ? after.split('\n').length : 0,
  };
}
