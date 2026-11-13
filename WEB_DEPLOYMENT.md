# Automatic web deployments

The `deploy_web` job in `.gitlab-ci.yml` builds the Expo web app and uploads it
to the existing Cloudflare Pages project after every push to `main`, once all
validation jobs pass. Render continues hosting the backend.

The pipeline runs on the private GitLab.com mirror. Add the variables below to
that mirror, not the university GitLab project. A commit pushed to capstone must
reach the mirror before its pipeline can run.

## 1. Find the Cloudflare account ID and project name

1. Sign in at https://dash.cloudflare.com/ and select your account.
2. Open Workers & Pages and select the project serving
   https://keepers-9qp.pages.dev.
3. Copy the project's exact name as displayed in the dashboard. It may differ
   from the generated website address.
4. The account ID is the 32-character identifier immediately after
   `dash.cloudflare.com/` in the dashboard address. Copy that identifier.

## 2. Create a deployment token

1. Open your Cloudflare profile and select API Tokens.
2. Select Create Token, then create a Custom token.
3. Name it `Keepers GitLab deployment`.
4. Add the permission Account > Cloudflare Pages > Edit.
5. Under Account Resources, include only the account containing this project.
6. Create the token and copy it into the GitLab variable below. Do not commit
   the token or put it in an `EXPO_PUBLIC_*` variable.

Cloudflare documents this token and upload flow at:
https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/

## 3. Add variables to the GitLab.com mirror

1. Open the mirror repository on GitLab.com.
2. Under Settings > Repository > Branch rules, ensure `main` is protected.
   GitLab versions may show a separate Protected branches section instead.
3. Open Settings > CI/CD, expand Variables, and select Add variable.
4. Add these three variables, with environment scope `production`:

| Key | Value | Visibility | Protected |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | The token you just created | Masked and hidden | Yes |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID | Visible | Yes |
| `CLOUDFLARE_PAGES_PROJECT_NAME` | The exact Pages project name | Visible | Yes |

Leave variable-reference expansion disabled. If Masked and hidden is unavailable,
use Masked for the token.

The build uses the Render URL `https://keepers-fu6r.onrender.com` and the public
Supabase configuration in `Keepers/public-config.ts`. It disables dotenv loading
and removes development AI provider keys before exporting the website.

## 4. Activate and verify

1. Commit the pipeline changes and push/merge them into `main` on capstone.
2. Wait for that commit to reach the GitLab.com mirror.
3. In the mirror, open Build > Pipelines and open the pipeline for that commit.
4. After the validation jobs pass, `deploy_web` should start automatically.
5. Once it passes, open https://keepers-9qp.pages.dev/swiper and reload the page.

The job reads the existing Pages project's production branch name before
uploading, so a Direct Upload project does not need its branch settings changed.
Deployments are serialized to avoid simultaneous uploads. In GitLab's deployment
settings, keep Prevent outdated deployment jobs enabled to prevent an older
pipeline from replacing a newer deployment.

If deployment fails with a missing-variable message, check that the variables
are on the mirror, scoped to production, and available to protected `main`.
If validation fails, fix that failure before retrying the pipeline.

Once `keepers.fashion` is connected to this same Pages project, these deployments
will update the custom domain too. No domain configuration is needed for each
release.
