# Keepers

Keepers is a clothing recommendation app. A React Native (Expo) frontend lets a
user swipe through clothing items; a FastAPI backend serves recommendations
from a Supabase-hosted database using image embeddings built by the
processing/ML pipelines in this repo.

## Repo layout

| Folder | What it is |
| --- | --- |
| `Keepers/` | Expo / React Native app (the mobile frontend) |
| `server/` | FastAPI backend (recommendation API, talks to Supabase) |
| `Image_Process_PL/` | Image processing pipeline (background removal, embeddings) |
| `ML_Pipeline/` | ML scripts used to build/update the recommendation model |
| `Scrapers/` | Scrapers used to collect clothing item data/images |

## Running the app

You need two things running at once: the **backend server** and the **Expo
frontend**.

> **Note:** Both the frontend and backend need real Supabase credentials to
> actually load data (login, the clothing catalog, recommendations, etc. all
> come from Supabase). If you don't have keys for this project, the steps
> below will still get the app installed and running, but screens that fetch
> data will error out or show nothing. Reach out to the team if you need
> working credentials for a demo.

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS) and npm
- [Python 3.14](https://www.python.org/downloads/)
- The [Expo Go](https://expo.dev/go) app on your phone, or an Android/iOS
  simulator, to view the frontend

### 1. Frontend (`Keepers/`)

```bash
cd Keepers
npm install
```

Copy `.env.example` to `.env.local` and fill in the values (ask the team for
Supabase/server keys):

```bash
cp .env.example .env.local
```

Start the app:

```bash
npx expo start
```

This prints a QR code — scan it with Expo Go (Android) or the Camera app
(iOS) to open the app on your phone, or press `a`/`i`/`w` in the terminal to
open an Android emulator, iOS simulator, or web browser.

### 2. Backend (`server/`)

```bash
cd server
py -3.14 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in `server/` with your Supabase credentials:

```
SUPABASE_URL=
SUPABASE_KEY=
```

Start the API:

```bash
uvicorn main:app --reload --host 0.0.0.0
```

By default the frontend expects the server URL in `Keepers/.env.local`
(`EXPO_PUBLIC_SERVER_URL`) — point it at wherever `server/` is running
(e.g. `http://localhost:8000`, or an ngrok tunnel if testing on a physical
device that can't reach `localhost`).

### Shortcut (Windows)

[`dev.bat`](dev.bat) launches both the server and the Expo frontend in
separate terminal windows in one step, once both `Keepers/` and `server/`
are set up as above:

```bash
dev.bat
```

## GitLab CI/CD

Capstone GitLab remains the source of truth for code and merge requests. Set up
an outbound **push mirror** to a private GitLab.com project, including feature
branches. Push changes only to capstone; GitLab.com runs the instructions in
[`.gitlab-ci.yml`](.gitlab-ci.yml) using its hosted runners.

The workflow creates branch pipelines only on `gitlab.com`. It does not create
runner jobs on capstone, and it does not copy cloud pipeline results back to
capstone merge requests. Pipeline logs are available under **Build > Pipelines**
in the GitLab.com mirror.

The pipeline has one **Validate** stage on every mirrored branch:

- `frontend_typecheck` checks the frontend's TypeScript types.
- `frontend_lint` reports frontend lint problems.
- `backend_syntax` compiles the Python source to catch syntax errors.

Application builds and deployment are not enabled. No Expo account, EAS
configuration, or application credentials are needed for these checks. The
GitLab.com project must have hosted runners enabled, available compute minutes,
and any required account verification completed.

Frontend lint is temporarily non-blocking because the current app has known
React hook lint errors. The lint job will still show the errors in GitLab and
should become blocking after they are fixed by removing `allow_failure: true`
from the job.

### Returning results to capstone

Repository mirroring transfers Git branches, tags, and commits, not pipeline
results. GitLab supports
[external commit statuses](https://docs.gitlab.com/ci/ci_cd_for_external_repos/external_commit_statuses/)
on its Free tier. A reporting service can post a status for the same commit SHA
and source branch to capstone's
[commit status API](https://docs.gitlab.com/api/commits/#set-commit-pipeline-status),
with a link to the GitLab.com pipeline. That status can appear in capstone's
pipeline and merge-request views; detailed logs remain on GitLab.com.

The reporting service must reach both GitLab.com and capstone's private API.
One option is a small, approved campus service that polls the cloud pipeline
status and reports it to capstone. Another is university-approved network access
from the cloud reporter to capstone. A cloud CI job alone cannot report through
the existing firewall just by adding an API token.

Automatic reporting is not configured. Until it is, check the matching commit's
pipeline in GitLab.com before merging on capstone.
