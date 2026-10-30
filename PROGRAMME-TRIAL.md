# Curriculum and topic guide trial

The existing private Site now serves the programme workspace at `/`. The previous single-unit builder is retained at `/unit.html`, with its existing browser save key and original STP Word template. Original programmed Science drafts remain explicitly separate from new Claude generation.

## Trial flows

1. Create/import an overview: provide Ministry PDFs, DOCX text or JSON, plus department brief or overview. Review and accept the proposed map. Manual source statement editing is supported. Unit years are 7–10 and terms are 1–4; integrated subjects retain statement attribution.
2. Build one guide: confirm selected knowledge/practice statements. Generation receives the full programme, mapping and saved guide summaries. Guides are editable and exported into the retained template. Assessment, reporting, descriptors and capability selections remain manual; previously entered values survive regeneration.
3. Generate all: enter the agreed priority definitions, propose and accept programme mapping, then generate missing guides sequentially. Existing guides remain untouched. Each completed guide is saved, so a stopped/failed run can resume. A ZIP includes Word guides and a JSON programme backup.

Mapping keeps proposed opportunities and teacher-confirmed selections separate, includes reasons and gaps, and does not enforce equal counts. Updates to content/selections or planning settings mark accepted mapping as needing review. Word overview exports include the complete mapped statement list and provenance. Statements extracted from uploaded documents still require departmental source verification; server validation enforces fidelity to the selected records, not independent Ministry authenticity.

## AI provider setup

The programme workspace supports explicit server-side selection of Claude or Gemini using `AI_PROVIDER`. See `AI-PROVIDERS.md`. Keys stay in runtime secrets; no automatic cross-provider fallback runs. The Gemini trial uses `GEMINI_MODEL=gemini-3.8-flash` and needs a `GEMINI_API_KEY` secret before live generation can be tested. The Claude settings remain available and are not used while Gemini is selected. Provider quota errors do not trigger retries through another provider.

Shared prompts, versioned Ministry evidence, JSON validation, teacher-controlled fields and exact selected statement checks apply to both providers. Uploaded PDFs are sent as document blocks to Claude or inline PDF parts to Gemini. Overview generation uses four resumable year stages and streamed responses. Automated tests use mock providers; they do not spend tokens. The first Gemini live check should be one small guide based on public Ministry content, with quality and quota use reviewed before a full overview.

The Site remains owner-private and relies on its platform access boundary. Before expanding access, add durable identity-scoped programme storage and production rate/budget controls. Trial programmes and uploads are browser-local; the UI states this and supports JSON backup/restore. 4 MB/file, eight files per collection and 120-unit overview limits apply. Overview generation now runs in four year-specific stages, with a visible elapsed timer and Cancel button. Completed year proposals are checkpointed in the browser and resumed on retry when planning inputs are unchanged. A failed or cancelled request leaves accepted overviews and guides unchanged. Very large individual year responses can still require a smaller source scope.

## Checks

`npm test` covers the retained 44-topic Science generator and the new server's schema validation, origin checks, missing-key state, mocked Claude request, preservation of teacher decisions and exact selected wording. `npm run build && npm run validate` packages the embedded-asset Worker. Live single-guide generation has been checked. Full multi-subject and bulk quality still require department review and the final school-priority configuration. The recovery tests cover stalled response bodies, cancellation, invalid responses, year scope and resumed overview stages.

## Shared school configuration
School generation guidance and mapping definitions are maintained in `worker/school-standard.js` plus the retained model rules, not in the staff form. The API ignores standards/priority definitions supplied in programme JSON and uses this shared server configuration. Staff retain normal guide selections, mapping review and content editing. School priorities still await confirmed names and definitions; mapping reports pending school setup until the owner configures these. No staff-facing admin settings page is exposed.
