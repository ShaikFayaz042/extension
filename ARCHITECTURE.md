# Unified JobStack Architecture

This is the unified target project. Its manifest registers Extension 1's worker, side panel, auth bridge, applied-history scripts, and autofill, plus Extension 2's discovery page scripts. One side-panel document switches between Tracker and Discovery. Discovery markup and styles mount in a shadow root in that document, preserving the existing controls without a nested page or a second side panel.

## Discovery Lifecycle

Discovery
-> Eligibility
-> JD extraction
-> Matching / ranking
-> Application
-> Tracking

Discovered jobs and application records remain separate concepts. Search URL filters are not eligibility decisions. Matching is a future backend/client integration and is not implemented in this scaffold.

## External and Historical Applications

External application history
-> Sync
-> Reconciliation
-> Tracking

Platform history import is a secondary synchronization capability. Applications created by a future JobStack apply flow should be recorded directly and should not depend on a later platform-history scrape.

## Runtime Ownership

The target uses one MV3 service worker and one side panel. Page-context discovery scripts live under `content/discovery/`; applied-history page scripts live separately under `content/applied-jobs/`. Platform capabilities remain separate even when they target the same site. Sourced session, profile, backend, tracking, discovery, and queue operations live in their API/auth/application modules; scanner/JD UI orchestration remains in the preserved panel scripts. Apply-queue navigation clicks the known job-entry Apply CTA and can click one follow-up CTA after an external-site transition. Generic submit/send controls inside forms remain blocked; final application completion is not automated. Eligibility evaluation and candidate matching/ranking remain unimplemented.

The existing extension roots remain the behavior references during migration:
- Extension 1: `../applied jobs extension/`
- Extension 2: `../job discovery extension/`
