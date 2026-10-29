# Deploying Enosis Lead CRM on Netlify

The app is a server-rendered Next.js app with a PostgreSQL database and Google / Microsoft sign-in.
Netlify builds it from GitHub and runs the server parts as Netlify Functions. You need three things:

1. **A cloud PostgreSQL database** (Neon, through Netlify DB or neon.tech).
2. **Google and/or Microsoft sign-in** (the "Dev login" button is switched off in production).
3. **The Netlify site**, connected to the GitHub repository, with the environment variables below.

The repository is already set up for this: `netlify.toml` (build command, Node 22), Prisma engines for
Netlify's Linux servers, `npm run build:netlify` (applies database migrations, then builds), and
`npm run db:seed:prod` (sets up the workspace without sample data).

---

## 1. Create the database (Neon)

Either:

- **In Netlify:** *Site configuration → Extensions → Neon* (Netlify DB), or
- **At [neon.tech](https://neon.tech):** create a project. Pick the region closest to your Netlify functions
  (Netlify's default is **US East (Ohio), us-east-2**).

Copy the **direct** connection string (in Neon: *Connection details*, with **Connection pooling turned off**). It looks like:

```
postgresql://neondb_owner:••••@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Add `&connect_timeout=15&connection_limit=5` to the end. This is your `DATABASE_URL`.

> The direct (non-pooled) string is needed because the build runs `prisma migrate deploy`, which doesn't
> work through Neon's pooler. `connection_limit=5` keeps each function from opening too many connections.
> If you ever see Neon's pooled hostname (`-pooler`) in the variable, migrations will fail.

## 2. Set up sign-in

You need at least one. The callback URLs use your Netlify address, so create the Netlify site first
(step 3) if you don't know it yet, then come back and fill these in. Only `@enosisbd.com` accounts are let in
(`AUTH_ALLOWED_DOMAIN`).

**Google** ([Google Cloud Console](https://console.cloud.google.com/apis/credentials)):
- *Create credentials → OAuth client ID → Web application*
- Authorized redirect URI: `https://YOUR-SITE.netlify.app/api/auth/callback/google`
- Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
- If the OAuth consent screen is "Internal", only your Google Workspace users can sign in, which is what you want.

**Microsoft** ([Entra admin center → App registrations](https://entra.microsoft.com)):
- *New registration*, single tenant
- Redirect URI (Web): `https://YOUR-SITE.netlify.app/api/auth/callback/microsoft-entra-id`
- *Certificates & secrets → New client secret*
- `AUTH_MICROSOFT_ENTRA_ID_ID` = Application (client) ID, `AUTH_MICROSOFT_ENTRA_ID_SECRET` = the secret value,
  `AUTH_MICROSOFT_ENTRA_ID_ISSUER` = `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0`

## 3. Create the Netlify site

1. Netlify → *Add new project → Import an existing project → GitHub* → choose **syedsiddiqur-warid/Enosis-CRM**.
2. Build settings come from `netlify.toml`; leave them as they are.
3. Before the first deploy, open *Environment variables* and add:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The Neon direct connection string from step 1 |
| `AUTH_SECRET` | A long random string: run `npx auth secret` locally, or `openssl rand -base64 33` |
| `AUTH_TRUST_HOST` | `true` |
| `AUTH_ALLOWED_DOMAIN` | `enosisbd.com` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | From step 2 (if using Google) |
| `AUTH_MICROSOFT_ENTRA_ID_ID`, `_SECRET`, `_ISSUER` | From step 2 (if using Microsoft) |
| `APOLLO_API_KEY`, `LUSHA_API_KEY` | Optional, for enrichment |

   Don't set `AUTH_DEV_LOGIN`, and never put these values in the repository.
   Mark the secrets as *Secret* in Netlify so they're hidden in the UI and logs.
4. *Deploy*. The build applies the database migrations (creates the tables) and builds the app.

## 4. Set up the workspace (once)

The tables are empty after the first deploy. From this PC, point a PowerShell window at the Neon database and
run the production seed. It creates the admin user, roles, teams, properties, dropdown lists, record layouts,
the deal pipeline and the default automations, **without sample data**:

```powershell
$env:DATABASE_URL = "<the Neon direct connection string>"
$env:SEED_ADMIN_EMAIL = "siddiqur.rahim@enosisbd.com"
npm run db:seed:prod
Remove-Item Env:DATABASE_URL
```

The seed wipes record data before it runs, so it refuses to run against a non-local database that already has
contacts or companies (unless `SEED_FORCE=true`). Run it once, right after the first deploy.

> `npm run db:seed` (with sample companies, contacts and campaigns) is for local development and demos only.

## 5. Sign in and invite the team

Open `https://YOUR-SITE.netlify.app`, sign in with the admin account, then go to **Settings → Users & teams**
and add your teammates with their roles. They sign in with their own Google or Microsoft accounts.
Then import your Dynamics data in **Contacts → Import**.

## Updates

Every push to `main` on GitHub redeploys the site. New database migrations in the push are applied during the
build, before the new version goes live.

If the live database was set up before the country, state/province and time zone pick lists were added, run
`npm run db:sync` once against it (with `DATABASE_URL` set as in step 4). It adds new properties, updates the location pick lists and fills
each record's time zone from its location. It is safe to run again.

## Good to know

- **Function time limit.** Netlify Functions stop after about 10 seconds by default. Imports send 50 rows per
  request so each batch finishes well inside that; very large files simply take more batches.
- **Region.** Keep the Neon database in the same region as the Netlify functions; every page makes several
  database queries.
- **Custom domain.** If you add one (e.g. `crm.enosisbd.com`), add its callback URLs to Google/Microsoft too.
- **Backups.** Neon keeps point-in-time history (length depends on the plan). Export important data regularly
  from the list pages as well.
