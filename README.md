# PropMax Requirement Management System

Task-based requirement tracking for PropMax, SAP, Arch Tech and IT — dashboard, pipeline, task list, calendar and (for SAP) team rankings.

**Live site:** https://icandoit0332-oss.github.io/propmax-rms/

## How it fits together

| Part | Where |
|---|---|
| Website | This repo, served by GitHub Pages (`index.html`, `config.js`) |
| Sign-in | Firebase project `imarat-sap-aff7f` — the same accounts as the SAP RMS |
| Backend | Google Apps Script web app (`apps-script/Code.gs`) |
| PropMax data | Google Sheet **PropMax RMS - PropMax** |
| Arch Tech data | Google Sheet **PropMax RMS - Arch Tech** |
| IT data | Google Sheet **PropMax RMS - IT** |
| SAP data | The existing SAP RMS sheet — read live, **read-only** here |
| Attachments | Google Drive folder **PropMax RMS / Attachments** |

All three department sheets live in the Drive folder **PropMax RMS**. Each has these tabs:

- **Requirements** — one row per requirement. Rows marked `TRUE` in *Sample* are demo data; delete them when real work is logged.
- **Comments** — comments and attachment links.
- **History** — every change made from the website (who, when, what).
- **Team** — the department team list (from PropMax_Team.xlsx). Add people here to make them available as owners.
- **Access** — who can edit. `admin` or `editor` can log and update requirements; everyone else who signs in can view and comment.
- **Settings** — department name, ID prefix, workflow stages, group label and types.

## One-time setup (about 5 minutes)

1. Open https://script.google.com → **New project**, name it *PropMax RMS Backend*.
2. Replace the contents of `Code.gs` with `apps-script/Code.gs` from this repo. Save.
3. Choose the function **setupCheck** in the toolbar and click **Run**. Approve the permissions (Sheets, Drive, external requests). The log should list the three sheets, the SAP RMS and the Attachments folder.
4. **Deploy → New deployment →** type **Web app** · *Execute as:* **Me** · *Who has access:* **Anyone** → **Deploy**. Copy the URL ending in `/exec`.
5. Paste that URL into `config.js` as `scriptUrl` and commit.
6. Repo **Settings → Pages →** Source: *Deploy from a branch* · Branch: `main` / root → **Save**.

After a change to `Code.gs`, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

## Giving people access

- Everyone signs in with their work email. If they already use the SAP RMS, the same password works; otherwise they click **Create account**.
- To let someone edit a department, add their email to that sheet's **Access** tab with role `editor` (or `admin`).
- Global admins (edit everything) are listed in `CFG.admins` in `Code.gs`.

## Measures

- **Completion %** — closed ÷ logged. Task-based, no man-hours.
- **On-time delivery** — closed on or before the target date.
- **Rankings score (SAP)** — 50% on-time delivery + 30% completion + 20% overdue control; ranked from 5 closed requirements.
