# JobStacker

JobStacker is a Chrome/Edge browser extension built as a Manifest V3 extension for managing job applications, scanning job listings, and filling saved profile details into application forms. It is designed to work with the JobStack web app and backend, while keeping the final application submission under user control.

## Overview

The extension combines three main workflows:

- Application tracking: sync jobs already applied to from supported job platforms
- Job discovery: scan lists, extract job details, and apply site-specific filters
- Autofill: reuse profile and resume data on application forms in the browser

The project uses a single MV3 service worker, a unified side panel, and page-scoped content scripts for platform-specific extraction.

## Features

### Application tracking

The extension can pull application history from supported platforms, including:

- LinkedIn jobs tracker
- Naukri
- Wellfound
- Internshala

Tracked records are normalized into a consistent job format and can be sent to the JobStack backend for syncing and reporting.

### Discovery / scanning

The extension includes discovery logic for listing pages and job details from supported sites. This includes:

- site detection and extraction hooks
- job scanning and pagination support
- Naukri-specific filtering and URL presets
- JD and detail extraction flow
- queue-based application workflow

### Autofill and profile handling

The extension includes browser-side autofill logic to:

- detect application forms
- populate profile fields from saved user data
- preview and optionally fill forms for job applications
- work with a JobStack session and profile API

### Unified side panel

The side panel is the main user interface. It supports:

- tracker view for detected jobs and sync status
- discovery view for scanning and filtering jobs
- settings and authentication status
- queue management and application flow state

## Supported platforms and status

The current project supports these primary integrations:

- LinkedIn: applied-history extraction and discovery hooks
- Naukri: history sync, listing extraction, and filters
- Wellfound: application history and listing extraction
- Internshala: application history sync
- Local development routes: localhost frontend and backend for testing

Important note: the project has partial or experimental support across some discovery pages, and the codebase explicitly documents that matching, ranking, and full auto-apply flows are not implemented in this version.

## Architecture

Core runtime pieces include:

- Background worker: background/service-worker.js
- Auth/session handling: auth/session.js
- Auth bridge for web app integration: auth/webapp-bridge.js
- API modules: api/client.js, api/profiles.js, api/discovery.js, api/applications.js, api/tracking.js
- Application queue logic: application/queue.js and application/apply-coordinator.js
- Content extraction scripts: content/
- Autofill engine: autofill/content.js
- Side panel UI: sidepanel/panel.html and sidepanel/panel.js

## Installation

1. Clone the repository.
2. Open Chrome or Edge and go to the extensions page.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the JobStacker project folder.
6. If you are using local development services, make sure the frontend and backend are running and reachable.

Typical local URLs used by the project:

- Frontend: http://localhost:5173
- Backend: http://localhost:5000
- Production backend: https://jobstack-api.onrender.com
- Production frontend: https://jobstack-live.vercel.app

## Basic usage

1. Open the JobStacker side panel from the extension icon.
2. Sign in or connect the extension to the JobStack backend/web app if required.
3. Open a supported job platform page and use the sync action to import applications.
4. Use the discovery view to scan supported job pages and review extracted job records.
5. Open application pages and use autofill when appropriate.
6. Complete the final submission manually as required by the site.

## Important limitations

This project is not a full automated job-apply bot. Current behavior is intentionally limited in a few important ways:

- Final application submission is not automated.
- Eligibility evaluation, matching, and ranking are not implemented in the current codebase.
- Some site integrations are platform-specific and may require page refreshes or user confirmation.
- The extension assumes valid auth/session data from the JobStack backend or web app.

## Development notes

- There is no bundler or build step required for the extension itself.
- Reload the extension after code changes in Chrome/Edge developer mode.
- Inspect the browser console and extension service worker logs for debugging.
- The extension relies on content script injection and host permissions for site access.

## Project structure

- api/ - backend and profile request helpers
- application/ - queue and apply coordination logic
- auth/ - session and web-app bridge logic
- autofill/ - form-filling automation
- background/ - service worker
- content/ - page-specific extraction and scanning scripts
- icons/ - extension icons
- shared/ - shared schema data
- sidepanel/ - extension UI
- manifest.json - MV3 extension manifest
- ARCHITECTURE.md - project architecture and migration notes
- MODULE_MAP.md - file ownership and migration mapping

## License

This project does not currently include a license file. If you are distributing or publishing the extension, confirm the appropriate licensing terms before release.
