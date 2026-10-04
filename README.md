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

GitLab CI/CD runs the instructions in [`.gitlab-ci.yml`](.gitlab-ci.yml) on a
GitLab Runner whenever code is pushed or a merge request is opened.

The initial pipeline has two stages:

1. **Validate** checks the frontend's TypeScript types, reports lint problems,
   and compiles the Python source to catch syntax errors.
2. **Build** exports the Expo web app and saves it as a downloadable pipeline
   artifact for one week.

Frontend lint is temporarily non-blocking because the current app has known
React hook lint errors. The lint job will still show the errors in GitLab and
should become blocking after they are fixed by removing `allow_failure: true`
from the job.

No credentials are required by this pipeline. If a future deployment needs
tokens or keys, add them under **Settings > CI/CD > Variables** in GitLab; do
not commit them to this repository.

### Continuous delivery versus deployment

The successful web artifact is a basic continuous-delivery result: every
validated commit produces something ready to deploy. Automatic deployment is
not enabled yet because each part of this project needs a destination:

- The Expo web build can be hosted on GitLab Pages or another static host.
- The FastAPI server needs a Python-capable host.
- Android and iOS releases normally use Expo EAS and the app stores.

After choosing those destinations, add a `deploy` stage and keep production
credentials in protected GitLab CI/CD variables.
