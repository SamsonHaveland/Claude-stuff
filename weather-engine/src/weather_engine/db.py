"""SQLite storage. Rows are keyed so every ingest can be re-run safely."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from pathlib import Path

from .records import Forecast, Observation

SCHEMA = """
CREATE TABLE IF NOT EXISTS forecasts (
    location   TEXT    NOT NULL,
    source     TEXT    NOT NULL,
    variable   TEXT    NOT NULL,
    valid_time INTEGER NOT NULL,
    issue_time INTEGER NOT NULL,
    value      REAL    NOT NULL,
    PRIMARY KEY (location, source, variable, valid_time, issue_time)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS observations (
    location   TEXT    NOT NULL,
    variable   TEXT    NOT NULL,
    valid_time INTEGER NOT NULL,
    value      REAL    NOT NULL,
    station    TEXT    NOT NULL,
    PRIMARY KEY (location, variable, valid_time)
) WITHOUT ROWID;
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


def _latest_values(conn, location: str, source: str) -> dict[tuple[str, int], float]:
    rows = conn.execute(
        """SELECT variable, valid_time, value FROM forecasts f
           WHERE location = ? AND source = ? AND issue_time = (
               SELECT MAX(issue_time) FROM forecasts
               WHERE location = f.location AND source = f.source
                 AND variable = f.variable AND valid_time = f.valid_time)""",
        (location, source),
    )
    return {(var, valid): value for var, valid, value in rows}


def save_forecasts(
    conn: sqlite3.Connection, rows: Iterable[Forecast], *, skip_unchanged: bool = False
) -> int:
    """Insert forecast rows; returns how many were written.

    With skip_unchanged, a row is dropped when the newest stored forecast for the
    same (location, source, variable, valid_time) already has that value. Hourly
    polling then stores each model run once instead of once per poll.
    """
    rows = list(rows)
    if skip_unchanged:
        latest: dict[tuple[str, str], dict] = {}
        kept = []
        for r in rows:
            key = (r.location, r.source)
            if key not in latest:
                latest[key] = _latest_values(conn, *key)
            prev = latest[key].get((r.variable, r.valid_time))
            if prev is None or abs(prev - r.value) > 1e-9:
                kept.append(r)
        rows = kept
    with conn:
        conn.executemany(
            "INSERT OR REPLACE INTO forecasts "
            "(location, source, variable, valid_time, issue_time, value) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [(r.location, r.source, r.variable, r.valid_time, r.issue_time, r.value) for r in rows],
        )
    return len(rows)


def save_observations(conn: sqlite3.Connection, rows: Iterable[Observation]) -> int:
    rows = list(rows)
    with conn:
        conn.executemany(
            "INSERT OR REPLACE INTO observations "
            "(location, variable, valid_time, value, station) VALUES (?, ?, ?, ?, ?)",
            rows,
        )
    return len(rows)


def load_forecasts(
    conn: sqlite3.Connection, location: str, start: int, end: int
) -> list[Forecast]:
    """Forecasts whose valid_time is in [start, end)."""
    cur = conn.execute(
        "SELECT location, source, variable, issue_time, valid_time, value FROM forecasts "
        "WHERE location = ? AND valid_time >= ? AND valid_time < ?",
        (location, start, end),
    )
    return [Forecast(*row) for row in cur]


def load_observations(
    conn: sqlite3.Connection, location: str, start: int, end: int
) -> dict[tuple[str, int], float]:
    cur = conn.execute(
        "SELECT variable, valid_time, value FROM observations "
        "WHERE location = ? AND valid_time >= ? AND valid_time < ?",
        (location, start, end),
    )
    return {(var, valid): value for var, valid, value in cur}


def time_range(conn: sqlite3.Connection, location: str) -> tuple[int, int] | None:
    row = conn.execute(
        "SELECT MIN(valid_time), MAX(valid_time) FROM observations WHERE location = ?",
        (location,),
    ).fetchone()
    return None if row[0] is None else (row[0], row[1])
