# Put the Weather Engine online (Google Cloud Run)

After this, the Weather Engine works on your phone from anywhere, with your
laptop off. It runs only while you're using it, and for one person's use
it's expected to stay within Google's free allowance. It's protected by a
password you choose.

Takes about 20–30 minutes the first time. Steps 1 and 5 happen in your web
browser, and steps 2–4 in Terminal on your Mac.

---

## 1. Create a Google Cloud account and project (browser)

1. Go to https://console.cloud.google.com and sign in with your Google account.
2. Accept the terms. When asked, **set up billing** and add a card. Google
   needs this even for free use; you're only charged for usage above the free
   allowance.
3. At the top of the page, click the **project picker** → **New project**.
   Name it `weather-engine` → **Create**.
4. Note the **Project ID** shown under the name. It's often the name plus
   numbers, e.g. `weather-engine-471203`. You'll need it in step 4.

## 2. Install Google's command-line tool on your Mac (Terminal, one time)

```
curl https://sdk.cloud.google.com | bash
```

Press Enter to accept the defaults. When it finishes, **close Terminal and
open a new window**, then sign in:

```
gcloud auth login
```

A browser window opens. Pick the same Google account and click **Allow**.

## 3. Check your keys are in `.env`

Your `weather-engine/.env` file should have these lines (with your real values):

```
WEATHER_ENGINE_SYNOPTIC_TOKEN=...
ANTHROPIC_API_KEY=...
```

The setup script reads them from this file and stores them in Google's Secret
Manager. They're never printed, never put in the app image, and never uploaded
to GitHub.

## 4. Run the setup script (Terminal)

```
cd ~/Claude-stuff/weather-engine
git pull
bash deploy/cloudrun.sh YOUR-PROJECT-ID
```

Replace `YOUR-PROJECT-ID` with the ID from step 1.

What happens:
- It turns on the Google services the app needs.
- It **asks you to choose a password** for the app. Type it twice; nothing
  shows while you type, which is normal.
- If it asks *"Deploying from source requires an Artifact Registry Docker
  repository... Do you want to continue?"*, type **Y**.
- Building takes about 5 minutes. At the end it prints your link, like
  `https://weather-engine-abc123-uc.a.run.app`.

## 5. Set a $1 budget alert (browser, important)

This emails you if anything ever starts costing money.

1. Go to https://console.cloud.google.com/billing → your billing account →
   **Budgets & alerts** → **Create budget**.
2. Name: `weather-engine`. Projects: your weather-engine project.
3. Amount: **$1**. Keep the alert thresholds (50%, 90%, 100%) and email
   alerts to billing admins → **Finish**.

## 6. Put it on your phone

1. Open the link from step 4 in **Safari** on your phone.
2. Search a place, then enter your password when asked. You stay logged in.
3. Tap **Share → Add to Home Screen**. It now opens like an app.
4. "Use my location" works here because the link is secure (https).

---

## Updating to a newer version later

```
cd ~/Claude-stuff/weather-engine
git pull
bash deploy/cloudrun.sh YOUR-PROJECT-ID
```

This keeps your password and station history. To **change the password**:

```
NEW_PASSWORD=1 bash deploy/cloudrun.sh YOUR-PROJECT-ID
```

## What it costs, and why it should be free

| Piece | Free allowance (per month) | Your expected use |
|---|---|---|
| Cloud Run (the app) | 2 million requests, 180,000 CPU-seconds, 360,000 GiB-seconds of memory | A forecast uses well under a minute of computing |
| Cloud Storage (station history) | A small amount of free storage in us-central1 / us-east1 / us-west1 | A few megabytes |
| Secret Manager (your keys) | A handful of secrets and 10,000 reads | 3 secrets |
| Artifact Registry (app images) | 0.5 GB | The script keeps only the 2 newest images |

Allowances are Google's published free tier and can change; the $1 budget
alert is your safety net. The app is limited to **one instance at a time**,
so it can't scale up and run up a bill.

Speed:
- **Reopening a place:** instant. Your phone shows the last forecast
  straight away and quietly updates it, and the server reuses a forecast for 20
  minutes (tap **Refresh** to force a new one).
- **First open after a quiet spell:** a few extra seconds while Google starts
  the app (startup CPU boost is on to shorten this).
- **A brand-new place:** the slowest case (expect 15–40 seconds), because it
  searches stations and downloads about 4 months of past runs from 9 models
  plus a year of station history. Everything is kept in the bucket, so later
  visits only fetch what's new, and each visit adds 2 more months of model
  history (up to a year) for the weather-pattern corrections.

To see where time goes: **Cloud Run → weather-engine → Logs**. Each forecast
logs a line like `forecast 'Primm, Nevada': 6.2s (models 1.1, calibration 4.8, ...)`.

Keeping one copy always running (`--min-instances 1`) would remove the startup
wait, but it is billed continuously and would no longer be free. Not
recommended.

## Where things are stored

- **Your keys and app password:** Google Secret Manager, readable only by the
  app's own restricted account.
- **Station history, forecast log, calibration:** a private Cloud Storage
  bucket named `YOUR-PROJECT-ID-weather-data`.
- **The app itself:** Cloud Run service `weather-engine`, region `us-central1`.

## Turning it off

- **Pause it:** nothing to do. It already runs only when you open it.
- **Delete the app:**
  `gcloud run services delete weather-engine --region us-central1`
- **Delete everything** (app, storage, secrets, billing usage): in the
  console, open your project → **IAM & Admin → Settings → Shut down**.

## If something goes wrong

| What you see | What to do |
|---|---|
| `gcloud: command not found` | Close Terminal, open a new window, and try again. If it still fails, redo step 2. |
| `PERMISSION_DENIED` or `billing account ... not found` | Billing isn't set up on the project yet; finish step 1.2. |
| The build fails or deploy errors out | Copy the last ~20 lines from Terminal and send them to Claude. |
| The phone says "Wrong password" | Re-run with `NEW_PASSWORD=1` (above) to set a new one. |
| The page loads but forecasts fail | In the console: **Cloud Run → weather-engine → Logs**, and send Claude the red lines. |
