import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const appOrigin = (process.env.APP_ORIGIN || ("http://localhost:" + port)).replace(/\/$/, "");
const clientId = process.env.STRAVA_CLIENT_ID || "275195";
const clientSecret = process.env.STRAVA_CLIENT_SECRET || "";
const apiBase = (process.env.STRAVA_API_BASE_URL || "https://www.strava.com/api/v3").replace(/\/$/, "");
const sessions = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function securityHeaders() {
  return {
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://www.strava.com",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), ...headers });
  res.end(body);
}

function json(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
}

function cookieMap(header = "") {
  return Object.fromEntries(header.split(";").map(function (part) {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(function (entry) { return entry[0]; }));
}

function sessionFor(req, res) {
  const cookies = cookieMap(req.headers.cookie);
  let id = cookies.overlays_session;
  let session = id && sessions.get(id);
  if (!session) {
    id = randomBytes(24).toString("hex");
    session = { createdAt: Date.now() };
    sessions.set(id, session);
    res.setHeader("Set-Cookie", "overlays_session=" + id + "; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800" + (appOrigin.startsWith("https://") ? "; Secure" : ""));
  }
  return session;
}

function configured() {
  return Boolean(clientId && clientSecret && clientSecret !== "replace_with_your_secret");
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function stravaTokenRequest(params) {
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const payload = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    throw new Error(payload.message || "Strava token request failed.");
  }
  return payload;
}

async function accessToken(session) {
  if (!session.tokens) throw new Error("Connect Strava first.");
  const expiresSoon = Number(session.tokens.expires_at || 0) <= Math.floor(Date.now() / 1000) + 120;
  if (expiresSoon) {
    session.tokens = await stravaTokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: session.tokens.refresh_token
    });
  }
  return session.tokens.access_token;
}

async function stravaGet(session, path) {
  const token = await accessToken(session);
  const response = await fetch(apiBase + path, {
    headers: { Authorization: "Bearer " + token }
  });
  const payload = await response.json().catch(function () { return {}; });
  if (!response.ok) {
    throw new Error(payload.message || "Strava request failed.");
  }
  return payload;
}

function publicActivity(activity) {
  return {
    id: activity.id,
    name: activity.name,
    sport_type: activity.sport_type,
    start_date_local: activity.start_date_local,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    total_elevation_gain: activity.total_elevation_gain,
    average_speed: activity.average_speed,
    max_speed: activity.max_speed,
    average_heartrate: activity.average_heartrate,
    max_heartrate: activity.max_heartrate,
    average_cadence: activity.average_cadence,
    average_watts: activity.average_watts,
    max_watts: activity.max_watts,
    map: activity.map ? { summary_polyline: activity.map.summary_polyline } : null
  };
}

async function handleApi(req, res, url, session) {
  if (req.method === "GET" && url.pathname === "/api/status") {
    return json(res, 200, {
      configured: configured(),
      connected: Boolean(session.tokens),
      athlete: session.athlete ? {
        id: session.athlete.id,
        firstname: session.athlete.firstname,
        lastname: session.athlete.lastname,
        profile: session.athlete.profile
      } : null
    });
  }

  if (req.method === "GET" && url.pathname === "/api/activities") {
    const activities = await stravaGet(session, "/athlete/activities?per_page=30&page=1");
    return json(res, 200, { activities: activities.map(publicActivity) });
  }

  const streamMatch = url.pathname.match(/^\/api\/activities\/(\d+)\/streams$/);
  if (req.method === "GET" && streamMatch) {
    const keys = "time,latlng,distance,altitude,velocity_smooth,heartrate,cadence,watts";
    const streams = await stravaGet(session, "/activities/" + streamMatch[1] + "/streams?keys=" + keys + "&key_by_type=true");
    return json(res, 200, { streams: streams });
  }

  if (req.method === "POST" && url.pathname === "/api/disconnect") {
    if (session.tokens) {
      const token = session.tokens.access_token;
      const basic = Buffer.from(clientId + ":" + clientSecret).toString("base64");
      await fetch("https://www.strava.com/oauth/revoke", {
        method: "POST",
        headers: {
          Authorization: "Basic " + basic,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ token: token })
      });
    }
    delete session.tokens;
    delete session.athlete;
    return json(res, 200, { disconnected: true });
  }

  return json(res, 404, { error: "Not found." });
}

async function serveStatic(res, pathname) {
  let relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  relative = normalize(relative);
  if (relative.startsWith("..") || relative.includes("\0")) {
    return send(res, 403, "Forbidden");
  }
  const path = join(root, relative);
  try {
    const details = await stat(path);
    if (!details.isFile()) return send(res, 404, "Not found");
    const body = await readFile(path);
    return send(res, 200, body, {
      "Cache-Control": relative.endsWith(".html") ? "no-cache" : "public, max-age=300",
      "Content-Type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream"
    });
  } catch {
    return send(res, 404, "Not found");
  }
}

const server = createServer(async function (req, res) {
  const url = new URL(req.url || "/", appOrigin);
  const session = sessionFor(req, res);
  try {
    if (req.method === "GET" && url.pathname === "/auth/strava") {
      if (!configured()) {
        return json(res, 503, { error: "The Strava server credentials are not configured." });
      }
      const state = randomBytes(24).toString("hex");
      session.oauthState = state;
      const authorize = new URL("https://www.strava.com/oauth/authorize");
      authorize.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: appOrigin + "/auth/strava/callback",
        response_type: "code",
        approval_prompt: "auto",
        scope: "read,activity:read",
        state: state
      }).toString();
      res.writeHead(302, { Location: authorize.toString(), ...securityHeaders() });
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/auth/strava/callback") {
      if (url.searchParams.get("error")) {
        return send(res, 302, "", { Location: "/app.html?error=access_denied" });
      }
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!safeEqual(state, session.oauthState) || !code) {
        return json(res, 400, { error: "Invalid OAuth callback." });
      }
      delete session.oauthState;
      const tokenPayload = await stravaTokenRequest({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: "authorization_code"
      });
      session.tokens = {
        access_token: tokenPayload.access_token,
        refresh_token: tokenPayload.refresh_token,
        expires_at: tokenPayload.expires_at
      };
      session.athlete = tokenPayload.athlete;
      return send(res, 302, "", { Location: "/app.html?connected=1" });
    }

    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url, session);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "Method not allowed");
    }
    return await serveStatic(res, url.pathname);
  } catch (error) {
    const status = error.message === "Connect Strava first." ? 401 : 502;
    return json(res, status, { error: error.message || "Unexpected server error." });
  }
});

server.listen(port, host, function () {
  console.log("Overlays is running at " + appOrigin);
  if (!configured()) console.log("Add STRAVA_CLIENT_SECRET before connecting Strava.");
});
