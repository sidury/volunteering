"""vol_store - saved data and rules for Volunteer Planner.

JSON files in $VOL_DATA_DIR, written atomically under one lock:
  entries.json        logged volunteer hours
  opportunities.json  roles from a school list or added by the student
  goal.json           the student's hours target

Dates arrive as YYYY-MM-DD from the student's browser, so "today" is always their own local day.
"""
from __future__ import annotations

import contextlib
import csv
import io
import json
import os
import re
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

VERSION = 1
STATUSES = ("draft", "submitted", "verified")
CAUSES = ("Animals", "Community", "Education", "Environment", "Food and hunger", "Health", "Seniors", "Other")
MAX_IMPORT_ROWS = 500
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class StoreError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def data_dir() -> Path:
    return Path(os.environ.get("VOL_DATA_DIR", "/data"))


@contextlib.contextmanager
def locked() -> Iterator[None]:
    folder = data_dir()
    folder.mkdir(parents=True, exist_ok=True)
    with open(folder / ".lock", "a+") as fh:
        try:
            import fcntl
            fcntl.flock(fh, fcntl.LOCK_EX)
        except ImportError:  # no fcntl on Windows, where tests may run for one user
            pass
        yield


def _read(name: str, default: Any) -> Any:
    path = data_dir() / name
    if not path.exists():
        return json.loads(json.dumps(default))
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError as e:
        raise StoreError(500, f"{name} could not be read; restore it from a backup") from e


def _write(name: str, value: Any) -> None:
    folder = data_dir()
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=f".{name}.", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(value, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, folder / name)


def _entries() -> dict:
    return _read("entries.json", {"version": VERSION, "nextId": 1, "entries": []})


def _opps() -> dict:
    return _read("opportunities.json", {"version": VERSION, "nextId": 1, "opportunities": []})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------- validation

def text(body: dict, key: str, limit: int, required: bool = True) -> str | None:
    value = body.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise StoreError(400, f"{key} is required")
        return None
    if not isinstance(value, str):
        raise StoreError(400, f"{key} must be text")
    value = value.strip()
    if len(value) > limit:
        raise StoreError(400, f"{key} must be {limit} characters or fewer")
    if any(ord(c) < 32 and c not in "\n\t" for c in value):
        raise StoreError(400, f"{key} contains invalid characters")
    return value


def number(value: Any, name: str, low: float, high: float, whole: bool = False) -> Any:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise StoreError(400, f"{name} must be a number")
    if whole and int(value) != value:
        raise StoreError(400, f"{name} must be a whole number")
    if not low <= value <= high:
        raise StoreError(400, f"{name} must be between {low:g} and {high:g}")
    return int(value) if whole else float(value)


def iso_date(value: Any, name: str = "date") -> str:
    if not isinstance(value, str) or not DATE_RE.match(value):
        raise StoreError(400, f"{name} must be a date like 2026-11-12")
    try:
        date.fromisoformat(value)
    except ValueError as e:
        raise StoreError(400, f"{name} is not a real date") from e
    return value


def _hours(value: Any) -> float:
    hours = number(value, "hours", 0.25, 24)
    if hours * 4 != int(hours * 4):
        raise StoreError(400, "hours must be in quarter-hour steps, like 1.25")
    return hours


def _clean_entry(body: dict) -> dict:
    day = iso_date(body.get("date"))
    # A day of grace covers students ahead of the server's clock.
    if date.fromisoformat(day) > date.today() + timedelta(days=1):
        raise StoreError(400, "you can't log hours for a future date")
    return {
        "date": day,
        "organization": text(body, "organization", 100),
        "activity": text(body, "activity", 200),
        "hours": _hours(body.get("hours")),
        "note": text(body, "note", 500, required=False) or "",
    }


def _clean_opportunity(body: dict) -> dict:
    cause = body.get("cause")
    if cause not in CAUSES:
        raise StoreError(400, f"cause must be one of: {', '.join(CAUSES)}")
    opp: dict[str, Any] = {
        "organization": text(body, "organization", 100),
        "title": text(body, "title", 150),
        "cause": cause,
        "date": iso_date(body.get("date")),
        "start": None, "end": None,
        "location": text(body, "location", 120, required=False) or "",
        "distanceMiles": None, "minAge": None, "maxAge": None,
        "details": text(body, "details", 1000, required=False) or "",
    }
    for key in ("start", "end"):
        value = body.get(key)
        if value not in (None, ""):
            if not isinstance(value, str) or not TIME_RE.match(value):
                raise StoreError(400, f"{key} must be a time like 09:30")
            opp[key] = value
    if opp["start"] and opp["end"] and opp["start"] >= opp["end"]:
        raise StoreError(400, "a shift must end after it starts")
    if body.get("distanceMiles") not in (None, ""):
        opp["distanceMiles"] = number(body["distanceMiles"], "distanceMiles", 0, 500)
    for key in ("minAge", "maxAge"):
        if body.get(key) not in (None, ""):
            opp[key] = number(body[key], key, 0, 120, whole=True)
    if opp["minAge"] is not None and opp["maxAge"] is not None and opp["minAge"] > opp["maxAge"]:
        raise StoreError(400, "minimum age can't be above maximum age")
    return opp


def _find(items: list, item_id: int, label: str) -> dict:
    for item in items:
        if item["id"] == item_id:
            return item
    raise StoreError(404, f"no {label} with id {item_id}")


# ---------------------------------------------------------------- hours log

def list_entries() -> list:
    return sorted(_entries()["entries"], key=lambda e: (e["date"], e["id"]), reverse=True)


def add_entry(body: dict) -> dict:
    entry = _clean_entry(body)
    with locked():
        data = _entries()
        entry.update(id=data["nextId"], status="draft", verifiedBy=None, verifiedAt=None, createdAt=_now())
        data["nextId"] += 1
        data["entries"].append(entry)
        _write("entries.json", data)
    return entry


def update_entry(entry_id: int, body: dict) -> dict:
    clean = _clean_entry(body)
    with locked():
        data = _entries()
        entry = _find(data["entries"], entry_id, "entry")
        if entry["status"] == "verified":
            raise StoreError(409, "undo the verification before editing this entry")
        entry.update(clean)
        _write("entries.json", data)
    return entry


def set_status(entry_id: int, body: dict) -> dict:
    status = body.get("status")
    if status not in STATUSES:
        raise StoreError(400, f"status must be one of: {', '.join(STATUSES)}")
    verifier = text(body, "verifiedBy", 100, required=False)
    if status == "verified" and not verifier:
        raise StoreError(400, "enter who verified these hours")
    with locked():
        data = _entries()
        entry = _find(data["entries"], entry_id, "entry")
        entry["status"] = status
        entry["verifiedBy"] = verifier if status == "verified" else None
        entry["verifiedAt"] = _now() if status == "verified" else None
        _write("entries.json", data)
    return entry


def delete_entry(entry_id: int) -> dict:
    with locked():
        data = _entries()
        entry = _find(data["entries"], entry_id, "entry")
        data["entries"].remove(entry)
        _write("entries.json", data)
    return {"removed": True, "id": entry_id}


# ---------------------------------------------------------------- opportunities

def list_opportunities() -> list:
    return sorted(_opps()["opportunities"], key=lambda o: (o["date"], o["start"] or "", o["id"]))


def add_opportunity(body: dict, source: str = "student") -> dict:
    opp = _clean_opportunity(body)
    with locked():
        data = _opps()
        opp.update(id=data["nextId"], source=source, going=False, createdAt=_now())
        data["nextId"] += 1
        data["opportunities"].append(opp)
        _write("opportunities.json", data)
    return opp


def update_opportunity(opp_id: int, body: dict) -> dict:
    clean = _clean_opportunity(body)
    with locked():
        data = _opps()
        opp = _find(data["opportunities"], opp_id, "opportunity")
        if opp["source"] != "student":
            raise StoreError(409, "items from a school list can't be edited")
        opp.update(clean)
        _write("opportunities.json", data)
    return opp


def set_going(opp_id: int, body: dict) -> dict:
    with locked():
        data = _opps()
        opp = _find(data["opportunities"], opp_id, "opportunity")
        opp["going"] = body.get("going") is True
        _write("opportunities.json", data)
    return opp


def delete_opportunity(opp_id: int) -> dict:
    with locked():
        data = _opps()
        opp = _find(data["opportunities"], opp_id, "opportunity")
        data["opportunities"].remove(opp)
        _write("opportunities.json", data)
    return {"removed": True, "id": opp_id}


def _optional_number(raw: str) -> float | None:
    raw = raw.strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError as e:
        raise StoreError(400, f"'{raw}' is not a number") from e


def _key(opp: dict) -> tuple:
    return (opp["organization"].lower(), opp["title"].lower(), opp["date"])


def import_csv(raw: bytes, confirm: bool) -> dict:
    """Reads a school's list. Without confirm it only reports what would change."""
    try:
        reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
        rows = list(reader)
    except (UnicodeDecodeError, csv.Error) as e:
        raise StoreError(400, "that file could not be read as a CSV") from e
    columns = {(c or "").strip().lower() for c in (reader.fieldnames or [])}
    missing = {"organization", "title", "date"} - columns
    if missing:
        raise StoreError(400, f"the file needs these columns: {', '.join(sorted(missing))}")
    if len(rows) > MAX_IMPORT_ROWS:
        raise StoreError(400, f"a list can have at most {MAX_IMPORT_ROWS} rows")

    causes = {c.lower(): c for c in CAUSES}
    valid, errors = [], []
    for number_on_sheet, row in enumerate(rows, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if isinstance(v, str)}
        try:
            minimum, maximum = _optional_number(row.get("min_age", "")), _optional_number(row.get("max_age", ""))
            valid.append(_clean_opportunity({
                "organization": row.get("organization"), "title": row.get("title"),
                "cause": causes.get(row.get("cause", "").lower(), "Other"), "date": row.get("date"),
                "start": row.get("start"), "end": row.get("end"), "location": row.get("location"),
                "distanceMiles": _optional_number(row.get("distance_miles", "")),
                "minAge": minimum, "maxAge": maximum, "details": row.get("details"),
            }))
        except StoreError as e:
            errors.append({"row": number_on_sheet, "error": e.message})

    with locked():
        data = _opps()
        known = {_key(o) for o in data["opportunities"]}
        fresh = []
        for opp in valid:
            if _key(opp) not in known:
                known.add(_key(opp))
                fresh.append(opp)
        skipped = len(valid) - len(fresh)
        if confirm:
            for opp in fresh:
                opp.update(id=data["nextId"], source="school", going=False, createdAt=_now())
                data["nextId"] += 1
                data["opportunities"].append(opp)
            _write("opportunities.json", data)
    return {"preview": not confirm, "new": fresh, "skippedDuplicates": skipped, "errors": errors}


# ---------------------------------------------------------------- goal and dashboard

def get_goal() -> dict | None:
    return _read("goal.json", None)


def set_goal(body: dict) -> dict:
    goal = {"hours": number(body.get("hours"), "hours", 1, 5000),
            "label": text(body, "label", 80, required=False) or "My goal", "deadline": None}
    if body.get("deadline") not in (None, ""):
        goal["deadline"] = iso_date(body["deadline"], "deadline")
    with locked():
        _write("goal.json", goal)
    return goal


def overview(today: str) -> dict:
    entries = list_entries()
    opps = list_opportunities()
    goal = get_goal()
    total = {s: round(sum(e["hours"] for e in entries if e["status"] == s), 2) for s in STATUSES}
    counted = round(total["verified"] + total["submitted"], 2)
    progress = None
    if goal:
        progress = {"percent": min(100, round(counted / goal["hours"] * 100)),
                    "verifiedPercent": min(100, round(total["verified"] / goal["hours"] * 100)),
                    "remaining": max(0.0, round(goal["hours"] - counted, 2))}
    shifts = [o for o in opps if o["going"] and o["date"] >= today]
    return {"today": today, "hours": {**total, "counted": counted}, "goal": goal, "progress": progress,
            "nextShift": shifts[0] if shifts else None,
            "awaitingSignoff": sorted((e for e in entries if e["status"] == "submitted"), key=lambda e: e["date"]),
            "drafts": [e for e in entries if e["status"] == "draft"],
            "recent": entries[:5], "entryCount": len(entries), "opportunityCount": len(opps)}
