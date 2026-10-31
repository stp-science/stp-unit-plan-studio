# Prepared junior curriculum indexes

The supplied junior catalogue is indexed ahead of staff use. `catalogue-banks.json` stores knowledge and practice records with subject, physical PDF page, source version/hash, source-cell coordinates, and the applicable year or language proficiency stage. Science retains its existing prepared bank.

`prepare-catalogue-banks.py` reads the original PDF table geometry locally, rather than asking a model to infer year columns from flattened text. Merged year cells are included in each labelled year. Dance, Drama, Music and Visual Arts remain separate. The five supplied language sequences retain Novice 1/2/3 stages; they are not assigned fixed school years. Language-example columns and whole-table contextual rows are not labelled as mandatory K/P statements. Section headings are retained as record context. Raised mathematical glyphs are normalised to Unicode superscripts where detectable; fractions and other mathematical layout still need checking against the PDF.

These are extracted drafts for departmental review, not a certification of complete official curriculum coverage. Review notes remain visible. Check source wording, examples, continuation across pages, notation, shared-year expectations and coverage before confirming a programme.

The server checks the source hash and prefers the bundled index over an older runtime cache. Selecting a supplied source therefore requires no AI indexing request. New or changed uploads still use the resumable runtime preparation flow.

Rebuild from the original supplied PDFs (matching catalogue SHA-256 hashes):

```sh
python scripts/prepare-catalogue-banks.py /path/to/original-pdfs
npm test
npm run build
```

Use `--source <catalogue-id>` to rebuild a single source after a full preparation. `preparation-audit.json` records processed table pages. Senior references remain in their separate searchable text catalogue and do not supply junior curriculum statements.

Source text is attributed to the New Zealand Ministry of Education and retains its source version and applicable copyright/licence metadata in `curriculum-catalogue/index.json`.
