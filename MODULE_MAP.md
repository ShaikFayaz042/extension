# Module Map

This is a target mapping. Extension 1 and Extension 2 runtime entry points share one manifest, worker, and side-panel document. Sourced auth, API, and queue logic is implemented in the modules listed below; mature page/side-panel behavior remains in its working feature scripts.

| OLD FILE | NEW TARGET | RESPONSIBILITY | STATUS |
|---|---|---|---|
| Extension 1 `background.js` | `background/service-worker.js`, `api/*`, `auth/session.js`, `content/applied-jobs/*` | Existing worker, auth, API, history extraction, resume/profile, and queue routing | worker uses shared session, profile, tracking, and application API modules |
| Extension 2 `background/service-worker.js` | `background/service-worker.js`, `auth/session.js`, `application/queue.js` | Panel shortcut, trusted web-app commands, JWT bridge, tab/window commands | command and JWT handling run through the single worker/session |
| Extension 1 `content-script.js` | `auth/webapp-bridge.js` | JobStack web-app session sync | copied and registered |
| Extension 2 `content/content.js` | `content/discovery/content.js` | Discovery-page dispatcher, platform detection, listing scan protocol, local development bridge | copied and registered |
| Extension 1 `content-linkedin.js` | `content/applied-jobs/content-linkedin.js` | LinkedIn applied/saved/draft tracker history extraction and pagination | copied, registered, and used for injection |
| Extension 1 `content-naukri.js`, worker Naukri API helpers | `content/applied-jobs/content-naukri.js`, `background/service-worker.js` | Naukri applied-history API capture and normalization | copied and registered |
| Extension 1 `content-wellfound.js` | `content/applied-jobs/content-wellfound.js` | Wellfound application-history DOM extraction | copied and registered |
| Extension 1 `content-internshala.js`, worker Internshala API helpers | `content/applied-jobs/content-internshala.js`, `background/service-worker.js` | Internshala application-history API capture and normalization | copied and registered |
| Extension 2 `content/extractors/naukri.js` | `content/discovery/extractors/naukri.js` | Naukri listing and detail extraction | copied and registered; detail/JD extraction stays in its existing platform extractor |
| Extension 2 `content/extractors/wellfound.js` | `content/discovery/extractors/wellfound.js` | Wellfound listing extraction | copied and registered |
| Extension 2 `content/extractors/linkedin.js` | `content/discovery/extractors/linkedin.js` | Reserved for validated LinkedIn listing extraction; current source file is empty | source copied; implementation unavailable |
| Extension 2 `content/extractors/indeed.js`, `foundit.js` | No target in the requested tree | Current files are empty and unregistered; reassess before adding support | not migrated |
| Extension 2 `content/filters/naukri-filters.js` | `content/discovery/filters/naukri-filters.js` | Naukri search URL filter capture/build; distinct from eligibility | copied and registered; filter presets UI integrated |
| Extension 2 `sidepanel/panel.js` | `sidepanel/discovery/panel.js`, `sidepanel/discovery/view-template.html`, `sidepanel/discovery/panel.css`, `api/discovery.js`, `application/queue.js`, `application/apply-coordinator.js` | Listing pagination, local buffer/upload, JD tab orchestration, queue UI, filter presets | discovery APIs, queue navigation, and guarded Apply CTA click use shared modules; final submission remains manual |
| Extension 1 `content-autofill.js` | `autofill/content.js`, `api/profiles.js` | Mature profile form filling, resume injection, field preview, submission/manual registration | full engine retained; profile/resume requests use Profile API module |
| Extension 1 `sidepanel.html`, `sidepanel.js` | `sidepanel/panel.html`, `sidepanel/panel.js` | Tracker, auth status, external application sync and autofill UI | retained as Tracker view in the unified panel |
| Extension 1 `icons/icon16.png`, `icon48.png`, `icon128.png` | `icons/` | Action and extension icons | copied |
| Extension 2 `sidepanel/panel.html`, `panel.css` | `sidepanel/discovery/view-template.html`, `sidepanel/discovery/panel.css` | Discovery view markup and isolated styling | mounted as a shadow-root component; missing Server view markup added in target |
| Extension 1 popup files | No target | No popup files exist in the current Extension 1 source inventory; the side panel is its UI entry point | not applicable |
| Extension 2 `shared/schema.js` | `shared/schemas.js` | Discovery job field shape | copied |
| Extension 2 `shared/storage.js` | No target module | Source file is empty; active storage remains in Chrome storage calls and application queue module | no behavior to migrate |
| Both extensions' backend calls | `api/client.js`, `api/profiles.js`, `api/discovery.js`, `api/applications.js`, `api/tracking.js` | Shared authenticated request, profile, discovery, queue, and application-history endpoints | implemented and used by worker/panel callers |
| Matching and full platform auto-apply | No target modules | Neither source extension contains matching/scoring or form-submit automation | unsupported stubs removed; final application submission remains manual |
| Extension 2 `ile-contentest.txt` | No target | Unreferenced dispatcher copy | pending removal review |
| Extension 2 `options/options.html`, `options.js` | No target | Empty, unregistered options page | pending removal review |
