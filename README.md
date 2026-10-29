# Enosis Lead CRM

HubSpot-style CRM for the Enosis lead research and cold-calling team (replaces the customized Dynamics CRM).
Stack: Next.js 15 (App Router) · TypeScript · Prisma 6 + PostgreSQL · Auth.js v5 · Tailwind v4 · Radix · TanStack Table/Virtual.

## Run locally

```bash
npm install
npm run db:up        # local Postgres-compatible server (prisma dev), no Docker needed
npm run db:migrate   # apply migrations
npm run db:seed      # metadata + sample data (TCP Software: 5 targets, 3 numbers, 3 CRTs)
npm run dev          # http://localhost:3000
```

Sign in with the **Dev login** on `/login` using any `@enosisbd.com` address (enabled by `AUTH_DEV_LOGIN=true`, never in production).
The seeded admin is `SEED_ADMIN_EMAIL` (defaults to siddiqur.rahim@enosisbd.com).

`scripts/check-filters.ts` (`npx tsx scripts/check-filters.ts`) smoke-tests the filter engine against the seed.

## Production

Set `DATABASE_URL` to Neon/Supabase, `AUTH_SECRET`, and Google (`AUTH_GOOGLE_ID/SECRET`) and/or Microsoft Entra ID
(`AUTH_MICROSOFT_ENTRA_ID_ID/SECRET/ISSUER`) credentials. Only `AUTH_ALLOWED_DOMAIN` emails can sign in. See `.env.example`.

**Netlify:** step-by-step guide in [docs/DEPLOY-NETLIFY.md](docs/DEPLOY-NETLIFY.md) (`netlify.toml`, `npm run build:netlify`
applies migrations then builds, `npm run db:seed:prod` sets up a workspace without sample data; the seed refuses to
wipe a non-local database that already has records).

## How it's built

- **Metadata-driven.** `PropertyDefinition`/`PropertyGroup` describe every property. Built-ins map to typed columns,
  custom properties live in a GIN-indexed `properties` jsonb column, so new properties are filterable immediately.
- **Views** (`SavedView`) persist filters, chips, columns (widths, frozen) and sort. Unsaved changes travel in the `st` URL param.
  Views can be shared privately, with a team or with everyone; admins can pin shared views. Each user's open tabs and
  default view live in `UserUiState` (`views:<OBJECT>`).
- **Filter engine** — `src/lib/crm/query.ts`: enum / text / number / date (incl. relative presets in Asia/Dhaka), jsonb,
  cross-association filters (contacts by company property and vice versa), logged-call filters (all call conditions in a
  group must match the same call), and segment membership, with advanced AND/OR groups. Custom (jsonb) properties sort
  through a raw SQL ordering step.
- **Segments** — active segments store `FilterGroup[]` and are evaluated live; static segments are `SegmentMember` rows
  (typed `contactId`/`companyId` links make membership filterable). Create them from the Segments page or from any list
  view ("Create segment from this view"), add records from the bulk bar, convert active → static, and export as CSV.
- **Record pages** render the stored `RecordLayout` (a team's layout when one exists, otherwise the default): header card,
  quick-action composers (note, email, call, task, meeting), Key information (personal property choice), property group
  cards, Overview/Activities tabs, and association cards (companies/contacts with labels and primary, phone numbers,
  deals, relevant Enosis projects, segments). Card collapse state is remembered per user (`UserUiState`).
- **Activities** are one table. Logging a call bumps the contact's CRT count and last-call dates, offers the follow-up
  task from `FollowUpRule`, and runs the "activity logged" `AutomationRule`s (`src/lib/crm/automation.ts`), which write
  their changes to the timeline and audit log. Property writes that automations share live in `record-writes.ts`.
- **Lead journey (company level)** — `Company.leadState` is the company's journey stage (Sourced → Researching →
  Researched → Viable → Callable → In campaign → Calling → Connected → Meeting booked → Opportunity → Customer, plus
  exit stages Not viable / Nurture / Disqualified / Do not contact, marked `kind: "exit"` in the options). Every change
  writes a `JourneyEvent` (from, to, when, who, source, reason, campaign) and stamps `leadStateAt`. Moves happen
  automatically and only forward (`src/lib/crm/journey.ts`, `advanceJourney` in `record-writes.ts`): research status /
  viable / callable changes, joining a live campaign, logged calls and meetings. People can move a company anywhere from
  the Lead journey card; exit stages need a reason.
- **Company-level tracking** — calls roll up to the company too (`crtCount`, `connectedCount`, `lastCallAt`, best
  `callStatus` across its contacts), so companies can be filtered and sorted by call history like contacts.
- **Buying signals** (`BuyingSignal`) — funding, hiring, leadership change, expansion, tech change, RFP… with source,
  strength and date. `Company.signalTypes` / `lastSignalAt` roll them up for chips and columns.
- **Campaigns** (`Campaign`, `CampaignCompany`) — company sets built from criteria and/or by hand (bulk bar on Companies,
  a segment, the record page). Criteria are the same `FilterGroup[]` as segments, so they can combine the customer
  profile, journey stage, contact properties, buying signals, logged calls and outcomes in earlier campaigns. Rules:
  only callable, skip exit stages, skip companies in another active campaign, skip recently contacted, and keep adding
  new matches while active. Each company has a campaign outcome (Queued → In progress → Connected → Meeting booked /
  Not interested / Nurture / Disqualified / Completed), caller, attempts, connects, last result and next action. Calls
  and meetings logged with a campaign selected update all of these plus the journey. Removed members are kept (soft) so
  syncs don't re-add them.
- **Related-row filters** — advanced filters can reach logged calls, buying signals and campaign memberships; conditions
  on the same kind of row in one AND group must match the same row. Contacts reach signals and campaigns through their
  companies. Non-nullable columns never get `null` comparisons (read from Prisma's DMMF).
- **Research** — `/research` is a board (To research → Researching → Researched → Viable → Callable / Not viable).
  Dropping a card sets research status, viable and callable (with "checked by / on" stamps); the journey follows.
  "Add sourced companies" takes a pasted list (name, domain or URL per line) with lead source, list source, batch and
  researcher, de-duplicates on domain and starts each company at *Sourced*.
- **Integrations** (`src/lib/crm/integrations.ts`, Settings → Integrations) — Apollo.io and Lusha company enrichment by
  domain (fills empty fields, optional overwrite, Apollo funding rounds become buying signals, optional auto-enrich on
  intake). Keys come only from `APOLLO_API_KEY` / `LUSHA_API_KEY` env vars; every run is logged in `EnrichmentRun`.
  Seamless.AI, Sales Navigator, ZoomInfo and directories have no open API, so their exports go through Research intake.
- **Calling queue** (`/prospecting`, `src/lib/crm/calling-queue*.ts`) — works through an active campaign's open companies
  (Queued / In progress / Connected) for one caller, everyone, or the unassigned ones: due follow-ups first, then
  companies never called, then retries (least recently called first), then ones scheduled later. Optionally only
  companies inside their business hours (Mon–Fri 9–17 local). Each company shows local time, targets (DNC disabled),
  numbers with IVR paths and status, signals, open tasks, the campaign pitch and every past attempt. One click (or keys
  1–9/0) logs the outcome with the chosen target, number, path, notes and call timer, creates the follow-up from the
  follow-up rules due on the company's next working morning, and moves on. "Call later" snoozes without logging.
  Logging a call also sets the dialed number's status from the outcome, clears the campaign's due date when there's no
  follow-up, and assigns an unassigned company to the caller.
- **Import** (`/import`, `src/lib/crm/import-*.ts`) — Excel (.xlsx, read in the browser with `read-excel-file`) or CSV
  for contacts and companies. Columns are matched to properties by label, internal name or common export aliases
  (Dynamics, Seamless.AI, Apollo…), or mapped by hand; mappings can be saved as templates (`ImportMappingTemplate`).
  A dry run validates every row first (dropdown values, dates, emails, users, Yes/No), then rows import in chunks.
  Contacts match by email and link to their company by domain then name (creating it at *Sourced* if new); companies
  match by domain then name. Modes: create + update, create only, update only; empty cells never erase data. Options:
  default owner, lead source and batch, add unknown dropdown values, put the batch in a new static segment. Every run
  is an `ImportJob`; failed rows can be downloaded with their errors. Templates: `/api/import/template`.
- **Dynamics CRM leads** (`src/lib/crm/dynamics-parser.ts`, shared by the review screen and the server) — contact
  imports can fill the lead's company from the same row (`Company › …` columns, empty fields only). The Description
  column's `Targets>>` lines become contacts (name, title, email, phone, LinkedIn), `Numbers>>` lines become phone
  numbers (type, IVR path such as "DBND 9, Sales 1, OPT 0", status, the person they belong to), and Caller Notes
  entries (`10/23/2026: 01:56 PM: CRT: (325-223-9500 OPT) VM.`) become calls with their time (Asia/Dhaka or the
  company's zone), number, path, outcome and target; other dated entries become notes and anything unreadable is kept
  as one note. Both columns are detected from their content. The review step shows every parsed item with a checkbox;
  unticked items are skipped. Re-imports don't duplicate calls or notes; CRT counts, call status and the lead journey
  are recalculated (never lowered). `npx tsx scripts/check-dynamics-parser.ts` exercises the parsers.
- **Settings** (`/settings`) — General (workspace name, AI toggle), Users & teams (roles, add users ahead of their first
  sign-in, deactivate — deactivated users can't sign in — teams and managers), Properties (rename, describe, regroup,
  edit dropdown options with colors and order; options are archived, never deleted, and keep their stored value when
  renamed; archive custom properties), Dropdown lists & follow-up rules, Import & templates (history, saved mappings),
  Integrations. Layouts, pipelines, permissions, automation and branding are listed for build step 11.
- **Phone numbers** (`phone-actions.ts`) — add and edit numbers (E.164, extension, type, IVR path, status, notes, whose
  line) from the record page, change status from the number's menu, delete with undo. The same number can't be on a
  record twice; calls keep the number they dialed if it's deleted.
- **Tasks** (`/tasks`, `tasks.ts`, `task-actions.ts`) — Due today / Overdue / Upcoming / All open / Completed tabs
  (Asia/Dhaka days) with counts, filters (assignee, type, priority, queue, search), list and board (drag between
  statuses) views, complete with undo, inline status, reschedule (+1 day / +2 days / +1 week / a date), and bulk
  complete, reschedule, assign, queue and delete (all with undo). Create tasks here (optionally about a contact or
  company), on record pages, or for every selected record from the Contacts/Companies bulk bar. Shared or personal
  task queues (`TaskQueue`) group tasks to work through.
- **Start tasks** (`/tasks/start`) — works through the current tab's open tasks one at a time beside the contact or
  company: local time and business hours, numbers with IVR paths, recent activity and the campaign pitch. Call tasks
  log an outcome in one click (keys 1–9/0) with timer, path, notes, campaign and follow-up rules, and complete the task;
  other tasks complete with an optional note (key C) or move to tomorrow, their next working morning or next week.
- **Home** (`/`, `home-loader.ts`) — the signed-in user's day (Asia/Dhaka): tasks due today and overdue (complete
  with undo, Start buttons), follow-ups (Next follow-up dates on records they own, plus campaign callbacks assigned to
  them that are due) grouped Overdue / Today / Next 7 days, today's meetings with join links, call stats (calls and
  connects today, 7-day connect rate, meetings booked, talk time, tasks done, calls per day with an outcome
  breakdown) and recently viewed records.
- Layouts, pipelines, option lists, automations and dashboards are seeded as data for the later build steps.

## Build status

| Step | Status |
| --- | --- |
| 1. Setup, auth, roles, schema, seed | ✅ |
| 2. App shell & design tokens | ✅ |
| 3. Contacts/Companies index (views, chips, filters, inline edit, column picker, footer, export) | ✅ |
| 4. Advanced filters, saved views, segments | ✅ |
| 5. Record pages (key info, timeline, composers, association cards) | ✅ |
| 5b. Campaigns, company lead journey, buying signals, research queue & intake, enrichment connectors | ✅ |
| 6. Phone numbers, call logger, CRT count and call status, tasks and Start tasks | ✅ |
| 10a. Calling queue (from step 10) | ✅ |
| 9. CSV/Excel import with mapping templates and Dynamics parsers (Targets>>, Numbers>>, Caller Notes) | ✅ |
| 11a. Settings: general, users & teams, properties, dropdown lists, follow-up rules, import, integrations | ✅ |
| 10b. Home page | ✅ |
| 7, 8, 10 (dashboards), rest of 11, 12 | Planned |

Known gaps: deals and the Board view toggle on Contacts/Companies (step 7); segments have no team-level sharing yet
(TEAM behaves like everyone); merge (step 11); AI Catch-up (step 12); task reminders and notifications (step 11).
The Apollo/Lusha adapters are written against their documented responses but haven't been run against the live APIs
(no keys in development). Deals moving companies to Opportunity / Customer arrive with deals (step 7). The calling
queue covers campaigns; working a plain saved view or segment comes with step 10.
