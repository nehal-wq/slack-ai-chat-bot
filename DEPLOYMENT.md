# Deploying Slack AI Workspace

The app runs as **one web service**: the Node backend also serves the built
React frontend, so everything (pages, API, call WebSocket) is on one HTTPS
address. Data lives in **MongoDB Atlas**.

You'll need accounts on: MongoDB Atlas (free), Render (free), and optionally a
TURN provider such as Metered (free tier) for calls on strict networks.

---

## 1. Create the database (MongoDB Atlas)

1. Sign up at <https://www.mongodb.com/cloud/atlas> and create a **free (M0)** cluster.
2. **Database Access** → add a database user with a strong password.
3. **Network Access** → add `0.0.0.0/0` (Render's outgoing IPs aren't fixed on the free plan).
4. **Connect → Drivers** → copy the connection string. Add the database name before `?`:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/slack_ai_workspace?retryWrites=true&w=majority
   ```

## 2. Copy your existing data to Atlas (optional)

From `backend/ai-chat-backend` (PowerShell), with your local MongoDB running:

```powershell
$env:COPY_FROM_URI = "mongodb://127.0.0.1:27017/slack_ai_workspace"
$env:COPY_TO_URI   = "<your Atlas connection string from step 1>"
npm run copy-db
```

This copies members, messages, DMs, settings **and sign-in sessions**, so
existing members stay signed in. It's safe to run more than once.

## 3. Deploy on Render

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, pick the repository. Render reads `render.yaml`
   and creates the `slack-ai-workspace` web service.
3. Fill in the environment variables it asks for:

   | Variable | Value |
   |---|---|
   | `FRONTEND_URL` | Your Render address, e.g. `https://slack-ai-workspace.onrender.com` (you can set it after the first deploy, then redeploy) |
   | `MONGODB_URI` | Atlas connection string from step 1 |
   | `OPENROUTER_API_KEY` | Your OpenRouter key |
   | `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Same Gmail settings as your local `.env` |
   | `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` | From your TURN provider (step 4), or leave empty |
   | `SLACK_*` | Only if you want the Slack bot running from the server |

4. Deploy. When it's live, open the address, go to **#general**, and sign in with your email.

> **Free plan notes:** the service sleeps after ~15 minutes without traffic, so the
> first visit afterwards takes up to a minute. If invite/sign-in emails don't
> arrive, your plan may restrict outgoing SMTP; check the Render logs for
> `SMTP` errors and consider a paid instance or a transactional email service.

## 4. Calls across networks (TURN, recommended)

Calls work peer-to-peer, but many office and mobile networks block direct
connections. A TURN server relays media in those cases.

1. Sign up for a TURN provider (e.g. Metered: <https://www.metered.ca/stun-turn>).
2. Copy its TURN URLs, username and credential into `TURN_URLS` (comma-separated),
   `TURN_USERNAME` and `TURN_CREDENTIAL` on Render, then redeploy.

The backend hands these to signed-in members when they join a call, so the
credentials never appear in the frontend code.

## Environment variables reference

See `backend/ai-chat-backend/.env.example` (backend) and
`frontend/my-react-app/.env.example` (frontend; normally nothing to set).

## Running locally

See the **Run locally** steps in the PR description, or in short:

```bash
# MongoDB running locally (default mongodb://127.0.0.1:27017)
cd backend/ai-chat-backend && npm install && npm run dev
cd frontend/my-react-app && npm install && npm run dev   # http://localhost:5173
```
