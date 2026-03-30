# Pipedrive MCP Connector

A custom MCP (Model Context Protocol) server that connects Claude / Cowork to your Pipedrive CRM.
Sends alerts to **Microsoft Teams** and deploys to any cloud server.

---

## What it does

| Category | Tools included |
|---|---|
| 🆕 New Leads | `get_new_leads`, `notify_new_leads`, `get_recent_deals` |
| 🔁 Duplicates | `find_duplicate_persons`, `find_duplicate_organizations`, `merge_persons`, `merge_organizations` |
| 📋 Tasks | `get_upcoming_activities`, `get_overdue_activities`, `notify_upcoming_tasks`, `notify_overdue_tasks`, `create_activity`, `mark_activity_done` |
| ⚙️ Automation | `update_deal_stage`, `update_deal_owner`, `bulk_update_deal_stage`, `add_note_to_deal`, `search_deals`, `get_pipelines_and_stages`, `get_users` |
| 📈 Analysis | `analyze_pipeline`, `get_win_loss_stats`, `get_stage_conversion`, `get_team_performance` |
| 📊 Reports | `generate_pipeline_report`, `generate_activity_report`, `generate_weekly_digest`, `get_deals_closing_soon` |

---

## Setup (step by step — no technical experience needed)

### Step 1 — Get your Pipedrive API token

1. Log in to Pipedrive
2. Click your name/avatar in the top right → **Personal preferences**
3. Go to the **API** tab
4. Copy the token shown — you'll need it in Step 3

### Step 2 — Set up a Teams Incoming Webhook

1. Open the Microsoft Teams channel where you want alerts
2. Click **"..."** next to the channel name → **Connectors** (or **Manage channel → Connectors**)
3. Search for **"Incoming Webhook"** and click **Configure**
4. Give it a name like `Pipedrive Alerts`, optionally upload an icon
5. Click **Create** and copy the long webhook URL — you'll need it in Step 3

### Step 3 — Configure environment variables

Copy the example file:
```
cp .env.example .env
```

Open `.env` in any text editor (Notepad, TextEdit, etc.) and fill in:
```
PIPEDRIVE_API_TOKEN=   ← paste your Pipedrive API token from Step 1
TEAMS_WEBHOOK_URL=     ← paste the Teams webhook URL from Step 2
MCP_AUTH_TOKEN=        ← make up a long random password, e.g. "my-secret-key-abc123xyz"
PORT=3000
```

> ⚠️ Never share or commit your `.env` file — it contains secrets.

### Step 4 — Deploy to Railway (easiest cloud option)

[Railway](https://railway.app) is free to start and deploys directly from GitHub.

1. Create a free account at **railway.app**
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Connect your GitHub account and push this folder as a new repo:
   ```
   git init
   git add .
   git commit -m "initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/pipedrive-mcp.git
   git push -u origin main
   ```
4. In Railway, select your new repo — it will auto-detect the Dockerfile
5. Go to **Variables** and add each variable from your `.env` file:
   - `PIPEDRIVE_API_TOKEN`
   - `TEAMS_WEBHOOK_URL`
   - `MCP_AUTH_TOKEN`
   - `PORT` = `3000`
6. Click **Deploy** — Railway gives you a public URL like `https://pipedrive-mcp-production.up.railway.app`

**Test it:** Visit `https://YOUR-URL.railway.app/health` — you should see:
```json
{ "status": "ok", "tools": 20, ... }
```

### Step 5 — Connect to Claude / Cowork

1. Open Claude (desktop app or Cowork)
2. Go to **Settings → MCP Servers** (or ask your admin to do this)
3. Add a new server with:
   - **URL:** `https://YOUR-URL.railway.app/sse`
   - **Auth header:** `Authorization: Bearer YOUR_MCP_AUTH_TOKEN`
4. Save — Claude will now have access to all 20 Pipedrive tools

---

## Deploying to other cloud providers

### Render (also free)
1. Go to **render.com** → New → Web Service
2. Connect your GitHub repo
3. Set **Environment** to `Docker`
4. Add the same environment variables under **Environment**
5. Deploy — Render gives you a `https://....onrender.com` URL

### AWS / GCP / Azure
For enterprise deployments, build and push the Docker image to your container registry, then run with any container service (ECS, Cloud Run, AKS).

---

## Running locally (for testing)

Make sure you have [Node.js 18+](https://nodejs.org) installed.

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or with auto-reload during development
npm run dev
```

The server runs at `http://localhost:3000`.
Visit `http://localhost:3000/health` to confirm it's running.

---

## Scheduling automatic alerts

You can schedule tools to run automatically using Claude's scheduled tasks feature, or set up a simple cron job on your server.

**Example cron (on your server) — send daily digest at 8am:**
```bash
0 8 * * * curl -s -X POST https://YOUR-URL.railway.app/messages \
  -H "Authorization: Bearer YOUR_MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tool":"generate_weekly_digest","args":{}}'
```

Or just ask Claude in Cowork: *"Every Monday at 9am, run generate_weekly_digest"* and it will set up the schedule for you.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `401 Unauthorized` | Check that `MCP_AUTH_TOKEN` matches in both `.env` and Claude's settings |
| `Pipedrive API error` | Check that `PIPEDRIVE_API_TOKEN` is correct and not expired |
| Teams messages not arriving | Check that `TEAMS_WEBHOOK_URL` is correct and the webhook is still active |
| Server won't start | Make sure all required env vars are set; check the deployment logs |

---

## File structure

```
pipedrive-mcp/
├── src/
│   ├── index.js          # MCP server entry point
│   ├── pipedrive.js      # Pipedrive API client + helpers
│   ├── teams.js          # Teams notification cards
│   └── tools/
│       ├── leads.js      # New lead alerts
│       ├── duplicates.js # Duplicate detection & merging
│       ├── activities.js # Task management
│       ├── automation.js # Pipeline automation
│       ├── analysis.js   # Sales analysis
│       └── reports.js    # Reports & digests
├── Dockerfile
├── railway.json
├── package.json
└── .env.example
```
