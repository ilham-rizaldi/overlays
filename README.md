# Overlays

Overlays turns Strava cycling activities into data for share-ready photo and video designs.

The public GitHub Pages site contains the landing page and a safe preview of the activity picker. Strava OAuth cannot run on GitHub Pages because the client secret must never be placed in browser code.

Local Strava beta

1. Copy .env.example to .env.
2. Add the real STRAVA_CLIENT_SECRET to your local environment. Never commit it.
3. In Strava API settings, use localhost as the authorization callback domain.
4. Export the values from .env in your terminal.
5. Run npm start and open http://localhost:3000/app.html.

The server requests read and activity:read access, stores tokens only in memory, refreshes expired access tokens, loads recent activities and streams, and supports disconnecting from Strava.

Production requirements

Deploy server.mjs to a server-capable host with HTTPS and persistent encrypted session storage. Set APP_ORIGIN to that host, add its domain to the Strava callback settings, and keep STRAVA_CLIENT_SECRET in the host's secret manager.

The public support and privacy contact is rizael.loo@gmail.com. The privacy policy and terms should be reviewed for the operator's jurisdiction before the full service launches.
