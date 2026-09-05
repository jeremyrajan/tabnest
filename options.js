import { DEFAULT_CATEGORIES } from "./categories.js";
import { normalizeDomain, normalizeSettings } from "./grouping.js";
const $ = id => document.getElementById(id);
let current;
let siteRules = [];
let dirty = false;
const markDirty = () => { dirty = true; };
function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
function addCategory(category = { title: "", color: "blue", emoji: "📁", domains: [], keywords: [] }, original = category.title) {
  const card = $("categoryTemplate").content.firstElementChild.cloneNode(true);
  card.dataset.original = original;
  card.querySelector(".name").value = category.title;
  card.querySelector(".emoji").value = category.emoji || "📁";
  card.querySelector(".color").value = category.color;
  card.querySelector(".domains").value = category.domains.join(", ");
  card.querySelector(".keywords").value = category.keywords.join(", ");
  card.querySelector(".remove").addEventListener("click", () => { card.remove(); markDirty(); });
  card.addEventListener("input", markDirty);
  $("categories").append(card);
  return card;
}
function renderRules() {
  $("rules").replaceChildren();
  if (!siteRules.length) { $("rules").textContent = "No corrections yet. Use Correct a website in the popup to remember one."; return; }
  for (const rule of siteRules) {
    const row = document.createElement("div"); row.className = "rule";
    const label = document.createElement("span"); label.textContent = `${rule.domain} → ${rule.category}`;
    const button = document.createElement("button"); button.textContent = "Remove";
    button.addEventListener("click", () => { siteRules = siteRules.filter(item => item !== rule); markDirty(); renderRules(); });
    row.append(label, button); $("rules").append(row);
  }
}
$("add").addEventListener("click", () => {
  if (document.querySelectorAll(".category").length >= 60) return status("You can have up to 60 categories.", true);
  $("search").value = "";
  document.querySelectorAll(".category").forEach(card => { card.hidden = false; });
  const card = addCategory(); markDirty(); card.querySelector(".name").focus();
});
$("search").addEventListener("input", () => {
  const search = $("search").value.toLowerCase();
  document.querySelectorAll(".category").forEach(card => { card.hidden = ![...card.querySelectorAll("input,textarea")].some(input => input.value.toLowerCase().includes(search)); });
});
$("reset").addEventListener("click", () => {
  $("categories").replaceChildren(); DEFAULT_CATEGORIES.forEach(category => addCategory(category)); markDirty();
  $("search").value = ""; status("Starting categories restored in this page. Save to apply.");
});
$("save").addEventListener("click", async () => {
  $("save").disabled = true;
  try {
    const names = new Set();
    const renamed = new Map();
    const split = value => value.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
    const categories = [...document.querySelectorAll(".category")].map(card => {
      const title = card.querySelector(".name").value.trim();
      if (!title) throw new Error("Give each category a name, or remove the empty category.");
      if (names.has(title.toLowerCase())) throw new Error(`Category names must be unique: ${title}`);
      if (title.toLowerCase() === "browsing") throw new Error("Browsing is reserved for unrecognized websites. Choose a different category name.");
      names.add(title.toLowerCase());
      const domains = split(card.querySelector(".domains").value);
      const keywords = split(card.querySelector(".keywords").value);
      if (domains.some(domain => !normalizeDomain(domain))) throw new Error(`Check the website domains in ${title}.`);
      if (domains.length > 150 || keywords.length > 150) throw new Error(`Use up to 150 domains and 150 keywords in ${title}.`);
      if (card.dataset.original) renamed.set(card.dataset.original, title);
      const emoji = card.querySelector(".emoji").value.trim() || "📁";
      return { title, emoji, color: card.querySelector(".color").value, domains, keywords };
    });
    // Read fresh preferences so editing categories does not overwrite a simultaneous pause/exclusion change.
    const latest = normalizeSettings((await chrome.storage.local.get("settings")).settings);
    const changedElsewhere = JSON.stringify(latest.categories) !== JSON.stringify(current.categories) || JSON.stringify(latest.siteRules) !== JSON.stringify(current.siteRules);
    if (changedElsewhere) throw new Error("Categories or website rules changed in another view. Reload this page before saving.");
    const rules = siteRules.map(rule => ({ ...rule, category: renamed.get(rule.category) || rule.category })).filter(rule => names.has(rule.category.toLowerCase()));
    const result = await chrome.runtime.sendMessage({ type: "settings", settings: { ...latest, categories, siteRules: rules } });
    if (!result?.ok) throw new Error(result?.error || "Could not save categories. Reopen Tabnest and try again.");
    current = result.data; siteRules = structuredClone(current.siteRules); dirty = false;
    $("categories").replaceChildren(); current.categories.forEach(category => addCategory(category)); renderRules();
    status(`${current.categories.length} categories saved.${current.enabled ? " Your open tabs have been organized." : " Automatic grouping is paused; click Organize in the popup to apply."}`);
  } catch (error) { status(error.message, true); }
  finally { $("save").disabled = false; }
});
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
try {
  current = normalizeSettings((await chrome.storage.local.get("settings")).settings);
  siteRules = structuredClone(current.siteRules);
  current.categories.forEach(category => addCategory(category)); renderRules();
  $("save").disabled = false; status(`${current.categories.length} starting categories. Add as many as you need, up to 60.`);
} catch (error) { status(error.message, true); }
