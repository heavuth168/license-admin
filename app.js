// License admin for VideoTranslate — a static page for GitHub Pages.
// Everything goes through Supabase with the signed-in admin's session; the
// database's Row Level Security refuses anyone who isn't in public.admins.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.VT_CONFIG || {};
const $ = (id) => document.getElementById(id);
const DAY = 86_400_000;

document.title = `${cfg.appName || "App"} · License admin`;
$("app-name").textContent = cfg.appName || "App";

const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes("YOUR-PROJECT")
  && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.startsWith("YOUR-");
const db = configured ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

let licenses = [];
let trials = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(value, withTime = false) {
  if (!value) return "";
  const d = new Date(value);
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}

async function copy(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { prompt("Copy this:", text); }
}

function fail(error) {
  console.error(error);
  toast(`Error: ${error.message || error}`);
}

function statusOf(l) {
  if (l.status === "revoked") return { key: "revoked", label: "Cancelled", cls: "danger" };
  if (l.expires_at && new Date(l.expires_at) < new Date()) return { key: "expired", label: "Expired", cls: "warn" };
  if (!l.activated_at) return { key: "unused", label: "Not activated", cls: "" };
  return { key: "active", label: "Active", cls: "ok" };
}

function expiryText(l) {
  if (l.expires_at) {
    const days = Math.ceil((new Date(l.expires_at) - Date.now()) / DAY);
    return `${fmtDate(l.expires_at)}${days > 0 ? ` <span class="muted">(${days}d)</span>` : ""}`;
  }
  if (l.duration_days) return `<span class="muted">${l.duration_days} days after activation</span>`;
  return "Lifetime";
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

function show(view) {
  for (const id of ["login-view", "setup-view", "app-view"]) $(id).hidden = id !== view;
}

async function start() {
  if (!configured) return show("setup-view");
  const { data: { session } } = await db.auth.getSession();
  session ? enter(session) : show("login-view");
}

async function enter(session) {
  // Only people listed in public.admins can see anything.
  const { data, error } = await db.from("admins").select("user_id").eq("user_id", session.user.id);
  if (error || !data?.length) {
    await db.auth.signOut();
    show("login-view");
    $("login-error").textContent = "This account isn't an admin. Add it to public.admins in Supabase.";
    return;
  }
  $("who").hidden = false;
  $("who-email").textContent = session.user.email;
  show("app-view");
  await Promise.all([loadLicenses(), loadTrials()]);
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  const button = event.submitter;
  button.disabled = true;
  const { data, error } = await db.auth.signInWithPassword({
    email: $("login-email").value.trim(), password: $("login-password").value,
  });
  button.disabled = false;
  if (error) { $("login-error").textContent = error.message; return; }
  $("login-password").value = "";
  enter(data.session);
});

$("logout").addEventListener("click", async () => {
  await db.auth.signOut();
  $("who").hidden = true;
  licenses = []; trials = [];
  show("login-view");
});

// ---------------------------------------------------------------------------
// Tabs and stats
// ---------------------------------------------------------------------------

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".tab")) other.classList.toggle("active", other === tab);
    for (const panel of document.querySelectorAll(".tab-panel")) panel.hidden = panel.id !== `tab-${tab.dataset.tab}`;
  });
}

function renderStats() {
  const counts = { active: 0, unused: 0, expired: 0, revoked: 0 };
  let pcs = 0;
  for (const l of licenses) { counts[statusOf(l).key]++; pcs += l.activations.length; }
  const liveTrials = trials.filter((t) => trialState(t).key === "running").length;
  const waiting = trials.filter((t) => trialState(t).key === "pending").length;
  const stats = [
    [licenses.length, "Keys"], [counts.active, "Active keys"], [pcs, "Activated PCs"],
    [counts.unused, "Not activated yet"], [counts.expired, "Expired"], [liveTrials, "Trials running"],
    [waiting, "Trial requests waiting"],
  ];
  $("stats").innerHTML = stats.map(([n, label]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join("");
}

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

async function loadLicenses() {
  const { data, error } = await db.from("licenses")
    .select("*, activations(id, machine_id, machine_name, app_version, created_at, last_seen_at)")
    .order("created_at", { ascending: false }).limit(2000);
  if (error) return fail(error);
  licenses = data;
  renderLicenses();
  renderStats();
}

function renderLicenses() {
  const query = $("search").value.trim().toLowerCase();
  const filter = $("filter").value;
  const rows = licenses.filter((l) => {
    if (filter !== "all" && statusOf(l).key !== filter) return false;
    if (!query) return true;
    const haystack = [l.key, l.customer, l.note, ...l.activations.flatMap((a) => [a.machine_id, a.machine_name])]
      .join(" ").toLowerCase();
    return haystack.includes(query);
  });

  $("license-rows").innerHTML = rows.map((l) => {
    const s = statusOf(l);
    return `<tr data-id="${l.id}">
      <td><span class="key" data-copy="${escapeHtml(l.key)}" title="Copy">${escapeHtml(l.key)}</span></td>
      <td><span class="pill ${l.plan === "pro" ? "pro" : ""}">${escapeHtml(l.plan)}</span></td>
      <td title="${escapeHtml(l.note)}">${escapeHtml(l.customer) || '<span class="muted">—</span>'}</td>
      <td><span class="pill ${s.cls}">${s.label}</span></td>
      <td>${expiryText(l)}</td>
      <td>${l.activations.length} / ${l.max_machines}</td>
      <td class="muted">${fmtDate(l.created_at)}</td>
      <td class="actions">
        <select data-action aria-label="Actions">
          <option value="">Actions…</option>
          <option value="pcs">View PCs</option>
          <option value="setdate">Set expiry date…</option>
          <option value="extend">Add days…</option>
          ${l.expires_at || l.duration_days ? '<option value="lifetime">Make lifetime</option>' : ""}
          <option value="machines">Change PC limit…</option>
          <option value="plan">Switch to ${l.plan === "pro" ? "Basic" : "Pro"}</option>
          <option value="customer">Edit customer / note…</option>
          <option value="reset">Remove from all PCs</option>
          <option value="${l.status === "revoked" ? "restore" : "revoke"}">${l.status === "revoked" ? "Restore" : "Cancel key"}</option>
          <option value="delete">Delete…</option>
        </select>
      </td>
    </tr>`;
  }).join("");
  $("license-empty").hidden = rows.length > 0;
}

$("search").addEventListener("input", renderLicenses);
$("filter").addEventListener("change", renderLicenses);
$("reload").addEventListener("click", loadLicenses);

$("license-rows").addEventListener("click", (event) => {
  const key = event.target.closest("[data-copy]");
  if (key) copy(key.dataset.copy, "Key copied");
});

$("license-rows").addEventListener("change", async (event) => {
  const select = event.target.closest("select[data-action]");
  if (!select) return;
  const action = select.value;
  select.value = "";
  const license = licenses.find((l) => l.id === select.closest("tr").dataset.id);
  if (license && action) await licenseAction(license, action);
});

async function update(license, changes, message) {
  const { error } = await db.from("licenses").update(changes).eq("id", license.id);
  if (error) return fail(error);
  toast(message);
  await loadLicenses();
}

async function licenseAction(l, action) {
  switch (action) {
    case "pcs":
      return showPcs(l);
    case "setdate": {
      const current = l.expires_at
        || (l.duration_days ? new Date(Date.now() + l.duration_days * DAY).toISOString() : null);
      const status = statusOf(l);
      const date = await askDate({
        title: `Expiry date for ${l.key}`,
        help: status.key === "expired"
          ? `Expired on ${fmtDate(l.expires_at)}. Pick a new date and the customer can use it again.`
          : l.expires_at ? `Now valid until ${fmtDate(l.expires_at)}.`
          : l.duration_days ? `Not activated yet (${l.duration_days} days from activation). A date replaces that.`
          : "Now lifetime. A date makes it expire.",
        current,
      });
      if (!date) return;
      return update(l, { expires_at: date, duration_days: null },
        `Valid until ${fmtDate(date)}${l.status === "revoked" ? " (still cancelled — Restore it too)" : ""}`);
    }
    case "lifetime":
      if (!confirm(`Make ${l.key} lifetime (never expires)?`)) return;
      return update(l, { expires_at: null, duration_days: null }, "Now lifetime");
    case "extend": {
      const days = parseInt(prompt(`Add how many days to ${l.key}?`, "30"), 10);
      if (!days || days < 1) return;
      if (l.expires_at) {
        const from = Math.max(new Date(l.expires_at).getTime(), Date.now());
        return update(l, { expires_at: new Date(from + days * DAY).toISOString() }, `Added ${days} days`);
      }
      if (l.duration_days) return update(l, { duration_days: l.duration_days + days }, `Added ${days} days`);
      return toast("This key is already lifetime.");
    }
    case "machines": {
      const max = parseInt(prompt("How many PCs may use this key?", String(l.max_machines)), 10);
      if (!max || max < 1 || max > 100) return;
      return update(l, { max_machines: max }, `PC limit set to ${max}`);
    }
    case "plan":
      return update(l, { plan: l.plan === "pro" ? "basic" : "pro" }, "Plan changed");
    case "customer": {
      const customer = prompt("Customer", l.customer);
      if (customer === null) return;
      const note = prompt("Note", l.note);
      if (note === null) return;
      return update(l, { customer: customer.slice(0, 120), note: note.slice(0, 300) }, "Saved");
    }
    case "reset": {
      if (!confirm(`Remove ${l.key} from all ${l.activations.length} PC(s)? The customer can activate again.`)) return;
      const { error } = await db.from("activations").delete().eq("license_id", l.id);
      if (error) return fail(error);
      toast("Removed from all PCs");
      return loadLicenses();
    }
    case "revoke":
      if (!confirm(`Cancel ${l.key}? It stops working at the next check (within a few hours, or at most 3 days offline).`)) return;
      return update(l, { status: "revoked" }, "Key cancelled");
    case "restore":
      return update(l, { status: "active" }, "Key restored");
    case "delete": {
      if (prompt(`Type DELETE to permanently delete ${l.key}.`) !== "DELETE") return;
      const { error } = await db.from("licenses").delete().eq("id", l.id);
      if (error) return fail(error);
      toast("Deleted");
      return loadLicenses();
    }
  }
}

// A date picker in a dialog. Resolves to an ISO time at the end of that day, or null.
function askDate({ title, help, current }) {
  const dialog = $("date-dialog");
  const input = $("date-input");
  $("date-title").textContent = title;
  $("date-help").textContent = help || "";
  const toInput = (d) => {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  };
  const start = current ? new Date(current) : new Date();
  input.value = toInput(start < new Date() ? new Date() : start);
  input.min = toInput(new Date());

  $("date-quick").onclick = (event) => {
    const add = parseInt(event.target.dataset?.add, 10);
    if (!add) return;
    // Add to the current date, or to today if the key has already expired.
    const base = current && new Date(current) > new Date() ? new Date(current) : new Date();
    input.value = toInput(new Date(base.getTime() + add * DAY));
  };

  return new Promise((resolve) => {
    dialog.onclose = () => {
      if (dialog.returnValue !== "ok" || !input.value) return resolve(null);
      resolve(new Date(`${input.value}T23:59:59`).toISOString());
    };
    dialog.returnValue = "";
    dialog.showModal();
  });
}

function showPcs(l) {
  $("pcs-key").textContent = l.key;
  $("pcs-rows").innerHTML = l.activations.map((a) => `<tr data-id="${a.id}">
      <td>${escapeHtml(a.machine_name)}</td>
      <td class="mono">${escapeHtml(a.machine_id)}</td>
      <td>${fmtDate(a.created_at, true)}</td>
      <td>${fmtDate(a.last_seen_at, true)}</td>
      <td>${escapeHtml(a.app_version)}</td>
      <td class="actions"><button type="button" class="ghost small danger" data-remove>Remove</button></td>
    </tr>`).join("");
  $("pcs-empty").hidden = l.activations.length > 0;
  $("pcs-dialog").showModal();
}

$("pcs-rows").addEventListener("click", async (event) => {
  if (!event.target.closest("[data-remove]")) return;
  const row = event.target.closest("tr");
  if (!confirm("Remove the key from this PC?")) return;
  const { error } = await db.from("activations").delete().eq("id", row.dataset.id);
  if (error) return fail(error);
  row.remove();
  toast("Removed");
  loadLicenses();
});

// ---------------------------------------------------------------------------
// Create keys
// ---------------------------------------------------------------------------

$("c-length").addEventListener("change", () => {
  const value = $("c-length").value;
  $("c-days-wrap").hidden = value !== "custom";
  $("c-date-wrap").hidden = value !== "date";
  $("c-on-activation").closest("label").hidden = value === "lifetime" || value === "date";
});

$("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("create-error").textContent = "";
  const length = $("c-length").value;
  const count = Math.min(100, Math.max(1, parseInt($("c-count").value, 10) || 1));
  const row = {
    plan: $("c-plan").value,
    max_machines: Math.min(100, Math.max(1, parseInt($("c-machines").value, 10) || 1)),
    customer: $("c-customer").value.trim(),
    note: $("c-note").value.trim(),
  };

  if (length === "date") {
    if (!$("c-date").value) { $("create-error").textContent = "Pick the expiry date."; return; }
    row.expires_at = new Date(`${$("c-date").value}T23:59:59`).toISOString();
  } else if (length !== "lifetime") {
    const days = length === "custom" ? parseInt($("c-days").value, 10) : parseInt(length, 10);
    if (!days || days < 1) { $("create-error").textContent = "Enter a number of days."; return; }
    if ($("c-on-activation").checked) row.duration_days = days;
    else row.expires_at = new Date(Date.now() + days * DAY).toISOString();
  }

  const button = event.submitter;
  button.disabled = true;
  // The database fills in each key (public.new_license_key()).
  const { data, error } = await db.from("licenses").insert(Array.from({ length: count }, () => ({ ...row })))
    .select("key");
  button.disabled = false;
  if (error) { $("create-error").textContent = error.message; return; }

  $("created-keys").textContent = data.map((d) => d.key).join("\n");
  $("created").hidden = false;
  toast(`Created ${data.length} key${data.length === 1 ? "" : "s"}`);
  loadLicenses();
});

$("copy-created").addEventListener("click", () => copy($("created-keys").textContent, "Keys copied"));

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

async function loadTrials() {
  const { data, error } = await db.from("trials").select("*")
    .order("started_at", { ascending: false }).limit(2000);
  if (error) return fail(error);
  trials = data;
  renderTrials();
  renderStats();
}

// A trial is "pending" (the app asked, nobody approved yet), or "approved" and then
// running until started_at + trialDays.
function trialState(t) {
  if ((t.status || "approved") !== "approved") return { key: "pending", label: "Waiting for approval", cls: "warn" };
  const ends = new Date(new Date(t.started_at).getTime() + (cfg.trialDays || 7) * DAY);
  return ends > new Date()
    ? { key: "running", label: "Running", cls: "ok", ends }
    : { key: "ended", label: "Ended", cls: "", ends };
}

function renderTrials() {
  const query = $("trial-search").value.trim().toLowerCase();
  const filter = $("trial-filter").value;
  const pending = trials.filter((t) => trialState(t).key === "pending").length;
  $("pending-badge").hidden = pending === 0;
  $("pending-badge").textContent = pending;

  const rows = trials.filter((t) => (filter === "all" || trialState(t).key === filter)
    && (!query || `${t.machine_id} ${t.machine_name}`.toLowerCase().includes(query)));
  // Requests waiting for approval first.
  rows.sort((a, b) => (trialState(a).key === "pending" ? 0 : 1) - (trialState(b).key === "pending" ? 0 : 1));
  $("trial-rows").innerHTML = rows.map((t) => {
    const s = trialState(t);
    const actions = s.key === "pending"
      ? `<button class="primary small" data-trial="approve">Approve ${cfg.trialDays || 7} days</button>
         <button class="ghost small danger" data-trial="delete">Decline</button>`
      : `<button class="ghost small" data-trial="date">Set end date…</button>
         <button class="ghost small" data-trial="restart">Restart trial</button>
         <button class="ghost small danger" data-trial="end">End now</button>`;
    return `<tr data-id="${escapeHtml(t.machine_id)}">
      <td class="mono">${escapeHtml(t.machine_id)}</td>
      <td>${escapeHtml(t.machine_name)}</td>
      <td><span class="pill ${s.cls}">${s.label}</span></td>
      <td>${fmtDate(t.started_at, true)}</td>
      <td>${s.ends ? fmtDate(s.ends) : '<span class="muted">—</span>'}</td>
      <td>${fmtDate(t.last_seen_at, true)}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("");
  $("trial-empty").hidden = rows.length > 0;
}

$("trial-search").addEventListener("input", renderTrials);
$("trial-filter").addEventListener("change", renderTrials);
$("trial-reload").addEventListener("click", loadTrials);

// Approve a Machine ID the customer pasted to you, whether or not they pressed "Request".
$("trial-add").addEventListener("submit", async (event) => {
  event.preventDefault();
  const machine = $("trial-machine").value.trim().toUpperCase();
  const existing = trials.find((t) => t.machine_id === machine);
  if (existing && trialState(existing).key !== "pending"
      && !confirm(`${machine} has had a trial already (${trialState(existing).label}). Start a new ${cfg.trialDays || 7}-day trial?`)) {
    return;
  }
  const { error } = await db.from("trials").upsert(
    { machine_id: machine, status: "approved", started_at: new Date().toISOString() },
    { onConflict: "machine_id" });
  if (error) return fail(error);
  $("trial-machine").value = "";
  toast(`Trial approved for ${machine}`);
  loadTrials();
});

$("trial-rows").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-trial]");
  if (!button) return;
  const machine = button.closest("tr").dataset.id;
  const trialDays = cfg.trialDays || 7;
  const trial = trials.find((t) => t.machine_id === machine);
  if (button.dataset.trial === "approve") {
    // The trial's days start now, not when it was requested.
    const { error } = await db.from("trials")
      .update({ status: "approved", started_at: new Date().toISOString() }).eq("machine_id", machine);
    if (error) return fail(error);
    toast(`Approved — ${trial.machine_name || machine} unlocks within a minute`);
    return loadTrials();
  }
  if (button.dataset.trial === "delete") {
    if (!confirm(`Decline the trial request from ${trial.machine_name || machine}?`)) return;
    const { error } = await db.from("trials").delete().eq("machine_id", machine);
    if (error) return fail(error);
    toast("Request declined");
    return loadTrials();
  }
  let startedAt;
  let message;
  if (button.dataset.trial === "date") {
    const ends = new Date(new Date(trial.started_at).getTime() + trialDays * DAY);
    const date = await askDate({
      title: "Trial end date",
      help: `${trial.machine_name || machine} — now ends ${fmtDate(ends)}.`,
      current: ends.toISOString(),
    });
    if (!date) return;
    // The server works out the end as started_at + trial days, so move the start.
    startedAt = new Date(new Date(date).getTime() - trialDays * DAY).toISOString();
    message = `Trial ends ${fmtDate(date)}`;
  } else if (button.dataset.trial === "restart") {
    startedAt = new Date().toISOString();
    message = "Trial restarted";
  } else {
    startedAt = new Date(Date.now() - (trialDays + 1) * DAY).toISOString();
    message = "Trial ended";
  }
  const { error } = await db.from("trials").update({ started_at: startedAt }).eq("machine_id", machine);
  if (error) return fail(error);
  toast(message);
  loadTrials();
});

start();
