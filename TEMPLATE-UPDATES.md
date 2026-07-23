# Template Updates

Applications created from this repository can adopt newer stable template
releases without replacing project-specific code.

```bash
npm run template:check
npm run template:update
npm run template:update -- 1.1.0
```

`template:check` is read-only and reports the latest stable release published
at [GitHub Releases](https://github.com/ghtkuhn/web-app-template/releases).
`template:update` requires a clean Git worktree and uses the normal GitHub
source archives for the installed and target tags.

## Update Behavior

The updater compares the old template, the local project, and the new template.
Unmodified template files update automatically. Local-only files and files
changed only by the project remain untouched. If both the project and template
changed the same file, no project files are changed and a report is written
under `.template/conflicts/<version>/`.

Secrets, local deployment profiles, databases, runtime artifacts, Memory,
Kanban task contents, dependencies, build output, and Git metadata are excluded
from template merging. The updater never commits, pushes, deploys, applies
database migrations, or deletes persistent infrastructure.

After applying a conflict-free update, the updater installs dependencies and
runs `npm run verify`. A failure restores every affected repository file. The
result remains uncommitted so a user or AI agent can inspect the diff before
creating a commit.

## Requirements and Security

- Node.js 22, Git, npm, and `tar`
- HTTPS access to GitHub
- stable release tags following `v<major>.<minor>.<patch>`
- a clean Git worktree for updates

GitHub tags and HTTPS are the v1 trust basis. `GITHUB_TOKEN` is optional for
higher API rate limits and must remain in the environment; it must never be
written to configuration or logs. Downgrades, prereleases, force-overwrites,
automatic conflict merges, and offline updates are intentionally unsupported.
