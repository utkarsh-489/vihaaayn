# विहाय — Through the Sky — Full MVP Deployment

This folder contains the complete working MVP source: React/Vite frontend, Express backend, SerpApi collector, data files, scripts, and tests.

## GitHub
Upload the contents of this folder to the repository root. Do not upload `.env` or `node_modules`.

## Local
From the repository root:

```powershell
npm.cmd install
npm.cmd install --prefix frontend
npm.cmd test
npm.cmd run build
npm.cmd start
```

Frontend + backend are served by the Express server after the frontend is built at:
`http://localhost:5000`

## Environment
Copy `.env.example` to `.env` and set `SERPAPI_KEY` locally. Never commit the real `.env` file.

## Vercel
Vercel can deploy the frontend, and Vercel also supports Express, but this MVP currently stores collection/index state in local JSON files. Vercel function/container filesystems are not durable storage, so a production deployment that needs persistent collection history should use an external database/object store or a stateful backend host.

For the unchanged full MVP architecture, deploy the complete repository on a Node-capable backend host (for example Railway/Render) and expose the built frontend from the same Express server, or deploy frontend and backend separately.
