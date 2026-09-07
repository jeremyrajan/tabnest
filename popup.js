import { normalizeDomain } from "./grouping.js";
const $ = id => document.getElementById(id);
const COLORS = { blue: "#648de5", purple: "#a17cdb", cyan: "#49a9b6", orange: "#d89143", red: "#dc756b", pink: "#d884ae", green: "#73a475", yellow: "#c6a445", grey: "#9a9e9b" };
let windowId;
let settings;
let currentStatus;
async function send(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, windowId, ...extra });
  if (!result?.ok) throw new Error(result?.error || "Could not reach Tabnest. Try reopening the extension.");
  return result.data;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
async function refresh(fill = false) {
  const status = await send("status");
  currentStatus = status;
  settings = status.settings;
  $("state").textContent = settings.enabled ? "Auto on" : "Paused";
  $("state").classList.toggle("paused", !settings.enabled);
  $("enabled").checked = settings.enabled;
  $("total").textContent = status.total;
  $("groupCount").textContent = status.groups.length;
  $("grouped").textContent = status.grouped;
  const info = status.diagnostics;
  const reasons = [];
  if (info?.ready) reasons.push(`${info.ready} tabs ready to group`);
  if (info?.waiting) reasons.push(`${info.waiting} tabs need more matches (minimum ${settings.minTabs})`);
  if (info?.manual) reasons.push(`${info.manual} tabs placed by you`);
  if (info?.existing) reasons.push(`${info.existing} tabs in existing groups`);
  if (info?.pinned) reasons.push(`${info.pinned} pinned tabs skipped`);
  if (info?.ineligible) reasons.push(`${info.ineligible} excluded or browser tabs skipped`);
  $("diagnostics").textContent = reasons.join(" · ");
  if (fill) {
    $("mode").value = settings.mode;
    $("minTabs").value = settings.minTabs;
    $("collapse").checked = settings.collapse;
    $("reuseDuplicates").checked = settings.reuseDuplicates;
    $("collectLoose").checked = settings.collectLoose;
    $("excluded").value = settings.excluded.join(", ");
    $("ruleSite").replaceChildren(...(status.websites || []).map(site => new Option(site.domain, site.domain, false, site.active)));
    $("ruleCategory").replaceChildren(...settings.categories.map(category => new Option(`${category.emoji || "📁"} ${category.title}`, category.title)));
    updateRule();
  }
  $("groups").replaceChildren();
  if (!status.groups.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = settings.mode === "smart" ? "Ready to sort your tabs into categories. Click Organize this window." : `Open ${settings.minTabs} tabs from the same website, then organize this window.`;
    $("groups").append(empty);
  }
  for (const group of status.groups) {
    const button = document.createElement("button");
    button.className = "group";
    button.setAttribute("aria-expanded", String(!group.collapsed));
    button.title = `${group.title || "Untitled group"} · ${group.managed ? "Managed by Tabnest" : "Your existing group"}`;
    const dot = document.createElement("span");
    dot.className = "group-dot";
    dot.style.setProperty("--group-color", COLORS[group.color] || COLORS.grey);
    const name = document.createElement("span");
    name.className = "group-name";
    name.textContent = group.title || "Untitled group";
    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${group.count} ${group.count === 1 ? "tab" : "tabs"}`;
    const arrow = document.createElement("span");
    arrow.className = "group-arrow";
    arrow.textContent = group.collapsed ? "›" : "⌄";
    button.append(dot, name, count, arrow);
    button.addEventListener("click", () => run(async () => { await send("toggleGroup", { groupId: group.id }); await refresh(); }));
    $("groups").append(button);
  }
}
function updateRule() {
  const site = currentStatus?.websites?.find(site => site.domain === $("ruleSite").value);
  const match = settings?.categories.find(category => category.title === site?.category);
  if (match) $("ruleCategory").value = match.title;
  $("ruleReason").textContent = site ? `Currently: ${site.category}. ${site.reason}.` : "No eligible websites in this window.";
}
$("ruleSite").addEventListener("change", updateRule);
$("manage").addEventListener("click", () => run(() => chrome.runtime.openOptionsPage()));
$("remember").addEventListener("click", () => run(async () => {
  if (settings.mode !== "smart") throw new Error("Switch to Categories and save preferences first.");
  await send("remember", { domain: $("ruleSite").value, category: $("ruleCategory").value });
  await refresh(true);
  message("Website category remembered and applied.");
}));
async function run(action) {
  const controls = [...document.querySelectorAll("button, input, select, textarea")];
  controls.forEach(control => { control.disabled = true; });
  try { await action(); } catch (error) { message(error.message, true); }
  finally { document.querySelectorAll("button, input, select, textarea").forEach(control => { control.disabled = false; }); }
}
$("organize").addEventListener("click", () => run(async () => {
  const result = await send("organize");
  await refresh();
  const waiting = currentStatus.diagnostics?.waiting;
  message(result.errors?.length ? `Chrome could not finish grouping: ${result.errors.join("; ")}` : result.changed ? "A little calmer. Your related tabs are organized." : waiting ? `No matches yet. ${waiting} tabs have fewer than ${settings.minTabs} related tabs under your current grouping rules.` : "No changes needed. See the tab breakdown above.", !!result.errors?.length);
}));
$("enabled").addEventListener("change", () => run(async () => {
  const enabled = $("enabled").checked;
  await send("settings", { settings: { ...settings, enabled } });
  await refresh();
  message(enabled ? "Automatic grouping is on in all regular windows." : "Automatic grouping paused. Your groups stay in place.");
}));
$("save").addEventListener("click", () => run(async () => {
  const entries = $("excluded").value.split(/[,\n]/).map(value => value.trim()).filter(Boolean);
  if (entries.some(value => !normalizeDomain(value))) throw new Error("Check your excluded websites. Use domains such as example.com.");
  if (entries.length > 100) throw new Error("Use up to 100 excluded websites.");
  await send("settings", { settings: { ...settings, mode: $("mode").value, minTabs: Number($("minTabs").value), collapse: $("collapse").checked, reuseDuplicates: $("reuseDuplicates").checked, collectLoose: $("collectLoose").checked, excluded: entries } });
  await refresh(true);
  message(settings.enabled ? "Preferences saved and applied." : "Preferences saved. Organize manually or turn auto grouping on to apply.");
}));
$("release").addEventListener("click", () => run(async () => {
  await send("release");
  await refresh();
  message("Automatic placements released. Auto grouping is paused.");
}));
run(async () => {
  windowId = (await chrome.windows.getCurrent()).id;
  await refresh(true);
  if (currentStatus.lastRun?.errors?.length) message(`Last grouping attempt: ${currentStatus.lastRun.errors.join("; ")}`, true);
});
