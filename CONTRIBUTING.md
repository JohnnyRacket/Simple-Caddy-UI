# Contributing

Thanks for your interest in contributing to caddy-ui!

## Running Locally

**Requirements:** Node.js 20+, a running Caddy instance (or the Docker dev environment)

### Option A — Docker (recommended for quick iteration)

```bash
docker compose up
```

Opens the UI at http://localhost:3000 with a sandboxed Caddy instance. No changes to your host system. Default login token is `password`.

### Option B — Direct

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/JohnnyRacket/Simple-Caddy-UI.git caddy-ui
   cd caddy-ui
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the values:
   ```bash
   cp .env.example .env.local
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

The app runs on http://localhost:3000.

## Pull Requests

- Keep PRs focused — one feature or fix per PR.
- Run `npm run build` before submitting to catch type errors.
- Run `npm run lint` to check for lint issues.
- Describe *why* the change is needed, not just what changed.
- If you're adding a feature, update the README if relevant.

## Reporting Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your OS and Node.js version

See [SECURITY.md](SECURITY.md) for reporting security vulnerabilities.
