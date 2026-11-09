# Volunteer Planner

A small app for students to track volunteer hours and find opportunities. It runs in one Docker
container on the student's own device, and its records stay there.

- **Dashboard:** hours so far, goal progress, next shift, and what still needs sign-off.
- **Hours log:** date, organization, activity and hours, moving from draft to submitted to verified.
- **Opportunities:** a list imported from a school's CSV file plus the student's own additions,
  filtered by cause, date, distance and age.

## Run it

```bash
docker build -f docker/Dockerfile -t vol-planner:dev .
docker run -d --name vol-planner -p 127.0.0.1:18081:8080 -v vol-planner-data:/data vol-planner:dev
```

Then open http://localhost:18081. To update, rebuild and replace the container with the same volume.

## How it works

| Path | What it is |
|---|---|
| `ui/` | React app |
| `tools/vol_store.py` | Rules and saved data, in JSON files on the `/data` volume |
| `tools/vol_api.py` | Local API, reached through nginx at `/api/` |
| `docker/` | Image build, nginx and startup |

There is no login, because the port is published only on `127.0.0.1`. The app refuses other
hostnames and cross-site requests.

## School lists

Import a CSV with `organization`, `title` and `date` columns. Optional columns are `cause`, `start`,
`end`, `location`, `distance_miles`, `min_age`, `max_age` and `details`. Dates use `YYYY-MM-DD`, and
the app has a template to download. An import is previewed first, and duplicates are skipped.

## Limits

- "Verified" is recorded by the student with the supervisor's name. It is not proof, and there is
  no signed form or supervisor login.
- Distance is whatever the list or student enters. The app doesn't calculate it.
- One student per install, with no AI features.

## Tests

```bash
python3 -m unittest discover -s tests
```

Browser tests need an empty volume and port 18081 free:

```bash
docker build -t vol-e2e ui/e2e
```

```bash
docker run --rm --network host -v "$PWD/ui/e2e:/opt/e2e/specs:ro" -w /opt/e2e/specs vol-e2e npx playwright test app.spec.ts
```
