# Weather Engine web app for Google Cloud Run.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Archive, forecast log and calibration live on the mounted Cloud Storage bucket;
    # the short-lived download cache stays on fast local disk.
    WEATHER_ENGINE_DATA=/data \
    WEATHER_ENGINE_CACHE=/tmp/weather-cache

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install ".[ai]" && useradd --create-home --uid 10001 app
USER app

# Cloud Run sets $PORT; serve reads it.
CMD ["weather-engine", "serve", "--host", "0.0.0.0"]
