#!/usr/bin/env bash
# Deploy the Weather Engine web app to Google Cloud Run.
#
# Run from the weather-engine folder on your Mac, after installing the Google
# Cloud CLI and running `gcloud auth login`:
#
#     bash deploy/cloudrun.sh YOUR-PROJECT-ID
#
# Safe to re-run: it updates what already exists (use it to ship new versions).
# Your Synoptic/Anthropic keys are read from .env and stored in Google Secret
# Manager; they are never printed, and never put in the image or in git.
set -euo pipefail

PROJECT_ID="${1:-}"
REGION="${REGION:-us-central1}"   # us-central1, us-east1, us-west1 are Always Free storage regions
SERVICE="weather-engine"
SA_NAME="weather-engine"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: bash deploy/cloudrun.sh YOUR-PROJECT-ID"
  echo "Find it at https://console.cloud.google.com (project picker at the top)."
  exit 1
fi
if ! command -v gcloud >/dev/null; then
  echo "The Google Cloud CLI isn't installed. See deploy/CLOUD_RUN.md, step 2."
  exit 1
fi
if [[ ! -f pyproject.toml || ! -f Dockerfile ]]; then
  echo "Run this from the weather-engine folder:  cd ~/Claude-stuff/weather-engine"
  exit 1
fi

BUCKET="${PROJECT_ID}-weather-data"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

step() { printf '\n==> %s\n' "$*"; }

env_value() {  # read KEY=value from .env without printing it
  [[ -f .env ]] || return 0
  grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//"
}

put_secret() {  # put_secret NAME VALUE  (create, or add a new version)
  local name="$1" value="$2"
  if gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --project "$PROJECT_ID" --data-file=- >/dev/null
  else
    printf '%s' "$value" | gcloud secrets create "$name" --project "$PROJECT_ID" \
      --replication-policy=automatic --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT_ID" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/secretmanager.secretAccessor >/dev/null
  echo "    saved secret: $name"
}

step "Using project ${PROJECT_ID} in ${REGION}"
gcloud config set project "$PROJECT_ID" >/dev/null

step "Turning on the Google services the app needs (first time takes a minute)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com iam.googleapis.com

step "Creating the app's own limited service account"
if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name "Weather Engine (Cloud Run)"
fi

step "Creating the storage bucket for station history (gs://${BUCKET})"
if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --location "$REGION" --uniform-bucket-level-access
fi
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member "serviceAccount:${SA_EMAIL}" --role roles/storage.objectAdmin >/dev/null

step "Storing your keys in Secret Manager"
SECRETS=()
SYNOPTIC="$(env_value WEATHER_ENGINE_SYNOPTIC_TOKEN)"
if [[ -n "$SYNOPTIC" ]]; then
  put_secret synoptic-token "$SYNOPTIC"
  SECRETS+=("WEATHER_ENGINE_SYNOPTIC_TOKEN=synoptic-token:latest")
else
  echo "    no WEATHER_ENGINE_SYNOPTIC_TOKEN in .env (all-network station search will be off)"
fi
ANTHROPIC="$(env_value ANTHROPIC_API_KEY)"
if [[ -n "$ANTHROPIC" ]]; then
  put_secret anthropic-key "$ANTHROPIC"
  SECRETS+=("ANTHROPIC_API_KEY=anthropic-key:latest")
else
  echo "    no ANTHROPIC_API_KEY in .env (plain-English summary will be off)"
fi

if gcloud secrets describe app-password --project "$PROJECT_ID" >/dev/null 2>&1 && [[ "${NEW_PASSWORD:-}" != "1" ]]; then
  echo "    keeping the existing app password (to change it: NEW_PASSWORD=1 bash deploy/cloudrun.sh ${PROJECT_ID})"
  gcloud secrets add-iam-policy-binding app-password --project "$PROJECT_ID" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/secretmanager.secretAccessor >/dev/null
else
  while true; do
    read -r -s -p "    Choose a password for the app (8+ characters): " PW1; echo
    read -r -s -p "    Type it again: " PW2; echo
    if [[ "$PW1" != "$PW2" ]]; then echo "    They didn't match, try again."; continue; fi
    if [[ ${#PW1} -lt 8 ]]; then echo "    Too short, use at least 8 characters."; continue; fi
    break
  done
  put_secret app-password "$PW1"
  unset PW1 PW2
fi
SECRETS+=("WEATHER_ENGINE_PASSWORD=app-password:latest")

step "Building and deploying (first time takes about 5 minutes)"
# The container runs as uid 10001 (see Dockerfile); the bucket is mounted with that owner so the app can write.
SECRET_ARG="$(IFS=,; echo "${SECRETS[*]}")"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --allow-unauthenticated \
  --execution-environment gen2 \
  --cpu 1 --memory 1Gi \
  --min-instances 0 --max-instances 1 \
  --concurrency 4 \
  --timeout 300 \
  --set-secrets "$SECRET_ARG" \
  --add-volume "name=data,type=cloud-storage,bucket=${BUCKET},mount-options=uid=10001;gid=10001;implicit-dirs" \
  --add-volume-mount "volume=data,mount-path=/data"

step "Keeping only the 2 newest app images (old ones would slowly cost storage)"
gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy --location "$REGION" \
  --policy deploy/artifact-cleanup.json >/dev/null \
  || echo "    (couldn't set the cleanup policy; harmless, see deploy/CLOUD_RUN.md)"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
step "Done! Your Weather Engine: ${URL}"
echo "    Open it on your phone, log in with your password, then Share > Add to Home Screen."
echo "    Don't forget the \$1 budget alert (deploy/CLOUD_RUN.md, step 5)."
