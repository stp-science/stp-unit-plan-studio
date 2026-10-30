# STP Unit Plan Studio

AI curriculum planning and topic guide generator for St Peter’s.

## Planning modes

1. Create a Years 7–10 curriculum overview from Ministry sources and a department brief, or import an existing overview.
2. Generate and adapt one topic guide using selected curriculum statements and practices.
3. Propose relevant capabilities and school priorities across a programme, then generate missing topic guides in a resumable batch.

Teachers review all drafts and retain control of assessment and tick-box decisions. Capability and priority coverage follows unit content rather than equal quotas.

## Source and hosting

This private GitHub repository contains a snapshot of the current working website, its Word template, curriculum catalogue, tests and server code. Source was initially imported from deployed commit `2738361b0c01157451c3be5e9b08724468fab3d9` on 30 October 2026.

The existing owner-private trial is currently hosted at https://stp-unit-plan-studio-prototype.talbotino.chatgpt.site. Copying the code to GitHub does not change that hosting or connect automatic deployment from GitHub. Keep the existing project identity in `.openai/hosting.json` when updating that Site; do not create a replacement Site accidentally.

GitHub Pages alone cannot run the private Claude API connection. The active Claude backend is `worker/api.js`; `backend/` is a separate legacy integration and is not the programme workspace's Claude backend.

## Run and check

Requires a current Node.js version supporting the browser-compatible Web APIs used by the Worker.

```sh
npm test
npm run build
npm run validate
npm run dev
```

The build packages the server and assets into `dist/server/index.js`. These generated files are retained here to preserve the deployed snapshot. See `PROGRAMME-TRIAL.md` for the trial flows, limits and detailed setup.

## Claude configuration

Set `ANTHROPIC_API_KEY` as a secret in the hosting service's runtime settings and set `CLAUDE_MODEL` to a supported model ID available to the school's API account. Redeploy after changing runtime settings.

Never put a real API key in this repository, the browser code, an attachment or a chat message. `.env.example` contains names only. The live trial's key and model are configured only in the hosting service, outside GitHub.

## Trial limitations

- Plans and uploads are stored in the user's browser. Use the built-in JSON backup/restore before changing browsers or clearing data. Plans are not shared or isolated by department accounts yet.
- The hosted trial remains owner-private. Staff access requires identity-scoped persistent storage and appropriate rate and budget controls before expanding the audience.
- School priority names and definitions still need to be confirmed in `worker/school-standard.js`. Programme mapping reports pending setup until these are configured.
- Ministry material includes draft/proposed sources. Provenance and version information are retained in the catalogue; staff must check applicability. Senior material is kept separate from junior curriculum statements and is used only as appropriate future-learning evidence.
- Overview generation builds one year at a time, streams the connection, and checkpoints completed years in the browser. A visible timer and Cancel button keep the form recoverable. Retry resumes completed stages when inputs are unchanged.
- Automated checks cover interrupted streams, stalled requests, cancellation, resumed year stages and exact selected statement retention. Generated curriculum drafts still require departmental review.

Third-party curriculum material and bundled vendor software retain their original attribution and licensing. This import does not add an open-source licence or change the repository's private visibility.
