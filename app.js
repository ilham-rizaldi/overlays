const message = document.querySelector("#app-message");
const connectButton = document.querySelector("#connect-button");
const disconnectButton = document.querySelector("#disconnect-button");
const refreshButton = document.querySelector("#refresh-button");
const workspace = document.querySelector("#activity-workspace");
const activityList = document.querySelector("#activity-list");
const emptyPreview = document.querySelector("#empty-preview");
const rideDetails = document.querySelector("#ride-details");
const rideName = document.querySelector("#ride-name");
const rideSport = document.querySelector("#ride-sport");
const rideDate = document.querySelector("#ride-date");
const previewMetrics = document.querySelector("#preview-metrics");
const streamStatus = document.querySelector("#stream-status");

function setMessage(text, tone) {
  message.textContent = text;
  message.dataset.tone = tone || "";
  message.hidden = !text;
}

function formatDistance(metres) {
  return (Number(metres || 0) / 1000).toFixed(1) + " km";
}

function formatDuration(seconds) {
  const total = Number(seconds || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? hours + "h " + String(minutes).padStart(2, "0") + "m" : minutes + " min";
}

function formatSpeed(metresPerSecond) {
  return (Number(metresPerSecond || 0) * 3.6).toFixed(1) + " km/h";
}

async function api(path, options) {
  const response = await fetch(path, options);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new Error("SERVER_NOT_RUNNING");
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function metric(label, value) {
  const item = document.createElement("div");
  const strong = document.createElement("strong");
  const span = document.createElement("span");
  strong.textContent = value;
  span.textContent = label;
  item.append(strong, span);
  return item;
}

async function selectActivity(activity, button) {
  document.querySelectorAll(".activity-card").forEach(function (card) {
    card.classList.toggle("selected", card === button);
  });
  emptyPreview.hidden = true;
  rideDetails.hidden = false;
  rideName.textContent = activity.name;
  rideSport.textContent = activity.sport_type || "Activity";
  rideDate.textContent = new Date(activity.start_date_local).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
  previewMetrics.replaceChildren(
    metric("DISTANCE", formatDistance(activity.distance)),
    metric("MOVING TIME", formatDuration(activity.moving_time)),
    metric("AVG SPEED", formatSpeed(activity.average_speed)),
    metric("ELEVATION", Math.round(activity.total_elevation_gain || 0) + " m")
  );
  streamStatus.textContent = "Checking detailed ride data…";
  try {
    const payload = await api("/api/activities/" + activity.id + "/streams");
    const available = Object.keys(payload.streams || {}).filter(function (key) {
      return payload.streams[key] && payload.streams[key].data;
    });
    streamStatus.textContent = available.length
      ? "Available overlay streams: " + available.join(", ") + "."
      : "No detailed streams are available for this activity.";
  } catch (error) {
    streamStatus.textContent = "Detailed data could not be loaded: " + error.message;
  }
}

function renderActivities(activities) {
  activityList.replaceChildren();
  if (!activities.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "No activities were returned by Strava.";
    activityList.append(empty);
    return;
  }
  activities.forEach(function (activity) {
    const button = document.createElement("button");
    button.className = "activity-card";
    button.type = "button";
    const title = document.createElement("strong");
    title.textContent = activity.name;
    const meta = document.createElement("span");
    meta.textContent = (activity.sport_type || "Activity") + " · " + formatDistance(activity.distance) + " · " + formatDuration(activity.moving_time);
    const date = document.createElement("small");
    date.textContent = new Date(activity.start_date_local).toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
    button.append(title, meta, date);
    button.addEventListener("click", function () { selectActivity(activity, button); });
    activityList.append(button);
  });
}

async function loadActivities() {
  setMessage("Loading your recent Strava activities…");
  try {
    const payload = await api("/api/activities");
    renderActivities(payload.activities || []);
    setMessage("");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function initialise() {
  const params = new URLSearchParams(location.search);
  if (params.get("error")) setMessage("Strava access was not approved.", "error");
  try {
    const status = await api("/api/status");
    if (!status.configured) {
      connectButton.hidden = true;
      setMessage("The interface is ready. Add the Strava server secret locally before connecting.", "warning");
      return;
    }
    if (!status.connected) {
      setMessage("Connect Strava to begin.");
      return;
    }
    connectButton.hidden = true;
    disconnectButton.hidden = false;
    workspace.hidden = false;
    await loadActivities();
  } catch (error) {
    connectButton.hidden = true;
    if (error.message === "SERVER_NOT_RUNNING") {
      setMessage("This GitHub Pages preview cannot hold the private Strava key. Run the secure Overlays server or deploy it to a server-capable host.", "warning");
    } else {
      setMessage(error.message, "error");
    }
  }
}

refreshButton.addEventListener("click", loadActivities);
disconnectButton.addEventListener("click", async function () {
  disconnectButton.disabled = true;
  try {
    await api("/api/disconnect", { method: "POST" });
    location.assign("/app.html");
  } catch (error) {
    setMessage(error.message, "error");
    disconnectButton.disabled = false;
  }
});

initialise();
