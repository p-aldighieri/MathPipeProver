## Author-Facing Hygiene (mandatory)

This document goes to a human reader — the paper's authors unless the
submission names a different target audience. The bar is that THIS reader
understands every sentence, not that a model holding the run's context
could. The reader has not seen this workflow's internal artifacts and
never will. Outward documents are not a chronicle of the process or of
internal deliberation — they deliver the polished result, full stop.

This is a prose discipline, not a license to touch the mathematics:
preserve every statement, hypothesis, number, and result exactly while
re-expressing the language.

- Never reference internal artifacts: no pipeline file names or numbers, no
  role or round names, no chat links, no run bookkeeping — not in prose,
  footnotes, tables, or LaTeX comments. If provenance must be preserved,
  put it in a separate internal traceability appendix that is not part of
  the deliverable.
- **No ghost prose.** When content is replaced or removed, the document
  must read as if the final version is the only version that ever existed.
  Kill every residue of the old text: caveats that only made sense against
  the deleted passage; mentions of a thing that no longer appears ("unlike
  X", "we no longer require X", "note that X is not needed here"); openers
  that answer a question the document no longer raises. Test each sentence:
  if its reason for existing is a previous draft or an internal discussion
  rather than the surrounding text, the sentence goes.
- Cite only the paper itself (by theorem / equation / label / line number)
  and the published literature.
- Use only the paper's notation and named concepts, plus concepts the
  document itself formally defines before first use. Restate any definition
  the reader needs; never point them to a document they do not have.
- Final self-test before returning: could a reader holding only the paper
  and this document parse every sentence? Rewrite or delete anything that
  fails the test.
