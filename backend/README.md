# STP Unit Plan Studio — administrator setup

The frontend now includes a versioned catalogue extracted from the Ministry of Education’s Science Years 0–10, August 2026 PDF: 44 topics across Years 7–10 and 326 knowledge statements. Teachers choose a year, topic and knowledge/practice statements. A programmed generator copies the exact statements into the original DOCX workflow and adds editable teaching suggestions. It is not a live document crawler. Other subjects are not connected. Gemini remains optional and is not configured by default.

## Optional Gemini service

Deploy `worker.mjs` with Cloudflare Wrangler from this directory. It imports the shared schema and planning instructions from `../unit-plan-builder/model.js`. Install Wrangler from its official npm package if needed. Use a school-managed Google project with billing/quota controls and an approved data policy.

Set `GEMINI_MODEL` in Wrangler configuration to a currently supported model that supports structured outputs. Store `GEMINI_API_KEY` and a strong random `ACCESS_TOKEN` as Worker secrets, using `wrangler secret put GEMINI_API_KEY` and `wrangler secret put ACCESS_TOKEN`. Keep keys out of Git, frontend code and chat. Deploy using `wrangler deploy`.

The configured `ALLOWED_ORIGIN` must exactly match the GitHub Pages origin. Requests also require the service access code; CORS alone is not authentication. The per-isolate rate limiter is only a prototype safeguard, not a durable budget control. Configure provider quotas and a durable rate limit or school identity before wider deployment.

In the site, select **AI connection**, enter the deployed HTTPS endpoint and service access code. The endpoint is stored locally; the code stays in memory until the page closes or reloads. Drafts and extracts are sent to the service and Gemini only on an explicit drafting/refinement request. The Google API key never enters the browser.

The server validates shape and unit metadata. The frontend also flags non-matching statement wording and requires users to review a proposal before applying it. Neither check establishes curriculum completeness or pedagogical quality.

## Without an API

Generate a curriculum draft or load Year 8 Evolution. In **Shape the draft → AI refinements**, copy the prepared prompt into the school's Gemini account. Paste the JSON response into the site and review it before applying. This tests Gemini-generated content with the same independent Word export.

## Template export

The original approved DOCX is `unit-plan-builder/template.docx`, from version 21 of STP_UNIT_PLAN_TEMPLATE_Niho_Taniwha_Revised.docx. Export alters only document content and author metadata, preserving styles, media, section setup and column definitions. Learning focus pairs are cloned in the continuation table; up to 16 are supported. Long content can cause additional pages. Word and Google Docs pagination must be checked separately. Use Word's PDF export for a fixed layout.

Device saving is local to this browser, with no central school database. Download a JSON working copy to transfer or back up a plan.

## Further viability testing

Verify exports with 1, 4 and 6 focuses and realistic long text. Check the A3 document in desktop Word and separately after Google Docs conversion. Trial a complete Ministry extract against a department-authored benchmark plan. Then connect Gemini and compare first drafts, revisions and statement fidelity. Department review of the extracted catalogue and teacher-planning rules is required before wider rollout. Knowledge statements are separated by subtopic; some practice lists are shared across a curriculum section, so teachers should confirm relevance.

## Curriculum source and verification

Source: Ministry of Education, *The New Zealand Curriculum — Science Years 0–10*, August 2026, pp. 19–22 and 24–31. The official Tahūrangi page is linked in `science-curriculum.json`; the downloaded Ministry-authored PDF was accessed through the Bay Science mirror because the Ministry page displayed no downloads. The PDF SHA-256, source URLs, version, page numbers and statement IDs are retained in the catalogue. Line wrapping and bullet markers are normalised; statement wording is not rewritten. Text is attributed under CC BY-NC 4.0; the Ministry logo is not reused.

Re-extract with `python scripts/extract-science-source.py /path/to/Science-Y0-10-12Aug26.pdf --audit /tmp/science-audit.json` (requires pdfplumber). Run `npm test` with a current Node runtime. The tests check selected-statement coverage, year boundaries, subset generation and protection against AI statement edits.

First drafts are programmed suggestions, not Gemini outputs. All 44 topics use topic-specific rationales, factual knowledge summaries and suggested prior/future curriculum connections. Named conceptual sections determine focus counts; the full Evolution example currently has eight focuses. There is no required count of four. School priorities and whakataukī require local decisions; the assessment descriptors are not claimed to be the school’s approved grading framework.

## School-guidance revision

Reviewed: *STP Curriculum Staff PLD 2027 Complete* v9 (22nd October 2026), *STP Unit Plan Staff Guide* (22nd October 2026), the current planning guide at https://stp-science.github.io/STP/unit-plan/, and template v21. The current website and Gary’s later instructions take precedence over older examples in the guide.

Purpose explains value; knowledge summaries describe the knowledge rather than statement counts; prior/future connections name specific prerequisite and subsequent learning. Connections are curriculum-progression suggestions: confirm them against the department’s actual taught programme. The app displays that distinction and leaves these fields editable. The school’s full year-by-year sequence is not configured.

Assessment End Point is blank on generation. Assessment Descriptors (three options) and Reporting (six options) use the exact template choices as unticked checkboxes. AI refinements cannot add assessment prose or change the teacher’s assessment selections. Word export preserves every original option and marks only selected choices. School Priorities remain optional, other-area connections and post-teaching review remain blank. Focus count follows the concepts, with add/remove/reorder available.

The 2026 Junior Science unit-changes guide is also used for supported school-programme links (including Evolution, forces, Waves, Plate Tectonics, and Ecosystems & Water). It is a partial programme record. Other links remain labelled Ministry-progression suggestions and should be checked against actual taught units. No full school timetable is inferred.

## Focus content and list revision

Resources is blank on generation and is preserved during refinements. Source attribution stays in source metadata and is included in the exported Word document properties. All learning focuses render as an always-open ordered list, with no details/summary collapse controls.

`focus-content.js` supplies specific teacher objectives, vocabulary, misconceptions and formative checks for the 154 non-Evolution conceptual sections. Evolution retains eight separately authored sections, with selected official practices repeated where they are explicitly developed. The generic describe-the-focus and common check/misconception fallback has been removed. The content is programmed drafting support, not live AI generation or curriculum approval.
