import { DEFAULT_CATEGORIES } from "./categories.js";
export const CATEGORY_SCHEMA_VERSION = 3;
export const DEFAULTS = Object.freeze({ enabled: true, mode: "smart", minTabs: 2, collapse: true, collectLoose: true, reuseDuplicates: true, excluded: [], categories: DEFAULT_CATEGORIES, siteRules: [], categorySchemaVersion: CATEGORY_SCHEMA_VERSION });


const COLORS = ["blue", "purple", "cyan", "orange", "pink", "green", "yellow"];
const VALID_COLORS = new Set([...COLORS, "grey", "red"]);
export function normalizeCategories(input) {
  if (!Array.isArray(input)) return structuredClone(DEFAULT_CATEGORIES);
  const names = new Set();
  return input.filter(item => item && typeof item.title === "string" && item.title.trim()).slice(0, 60).flatMap(item => {
    const title = item.title.trim().slice(0, 40);
    if (names.has(title.toLowerCase())) return [];
    names.add(title.toLowerCase());
    const emoji = Array.from(String(item.emoji || "").trim()).slice(0, 8).join("");
    return [{ title, color: VALID_COLORS.has(item.color) ? item.color : "blue", emoji, domains: Array.isArray(item.domains) ? [...new Set(item.domains.map(normalizeDomain).filter(Boolean))].slice(0, 150) : [], keywords: Array.isArray(item.keywords) ? [...new Set(item.keywords.filter(word => typeof word === "string").map(word => word.trim().toLowerCase().slice(0, 80)).filter(Boolean))].slice(0, 150) : [] }];
  });
}
function migrateCategories(raw) {
  const categories = normalizeCategories(raw.categories);
  if (Array.isArray(raw.categories) && Number(raw.categorySchemaVersion || 0) < CATEGORY_SCHEMA_VERSION) {
    const names = new Set(categories.map(category => category.title.toLowerCase()));
    for (const addition of DEFAULT_CATEGORIES.filter(category => category.title === "Education")) {
      if (!names.has(addition.title.toLowerCase())) categories.push(structuredClone(addition));
    }
  }
  for (const category of categories) {
    if (!category.emoji) category.emoji = DEFAULT_CATEGORIES.find(item => item.title === category.title)?.emoji || "📁";
  }
  return categories;
}
export function categoryGroupTitle(category) {
  return `${category.emoji || "📁"} ${category.title}`.trim();
}
const words = text => String(text || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function inferCategory(tab, url, categories) {
  // Ignore query strings and fragments, which often contain private or unrelated search text.
  const title = ` ${words(tab.pendingUrl && tab.pendingUrl !== tab.url ? "" : tab.title)} `;
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch {}
  const address = ` ${words(`${url.hostname} ${pathname}`)} `;
  const description = ` ${words(`${tab.siteName || ""} ${tab.description || ""}`)} `;
  const scored = categories.map(category => {
    let score = 0;
    for (const phrase of category.keywords) {
      const match = ` ${words(phrase)} `;
      if (match === "  ") continue;
      if (title.includes(match)) score += 3;
      if (description.includes(match)) score += 3;
      if (address.includes(match)) score += 2;
    }
    return { ...category, score };
  }).sort((a, b) => b.score - a.score);
  if (!scored[0] || scored[0].score < 3 || (scored[1] && scored[0].score === scored[1].score)) return null;
  return scored[0];
}
export function matchesDomain(host, domain) { return host === domain || host.endsWith(`.${domain}`); }
export function exactWebUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
export function findDuplicateTarget(current, tabs) {
  const url = exactWebUrl(current.pendingUrl || current.url);
  if (!url || current.pinned || current.incognito) return null;
  return tabs
    .filter(tab => tab.id !== current.id && tab.windowId === current.windowId && exactWebUrl(tab.pendingUrl || tab.url) === url)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.index - b.index)[0] || null;
}
export function normalizeDomain(value) {
  const input = String(value).trim().toLowerCase().replace(/^\*\./, "");
  if (!input) return null;
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password || /[\s*]/.test(url.hostname)) return null;
    return url.hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch { return null; }
}
export function normalizeSettings(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    mode: raw.mode === "site" ? "site" : "smart",
    minTabs: [2, 3, 4, 5].includes(Number(raw.minTabs)) ? Number(raw.minTabs) : 2,
    collapse: raw.collapse !== false,
    collectLoose: raw.collectLoose !== false,
    reuseDuplicates: raw.reuseDuplicates !== false,
    categories: migrateCategories(raw),
    siteRules: Array.isArray(raw.siteRules) ? raw.siteRules.filter(rule => rule && normalizeDomain(rule.domain) && typeof rule.category === "string").slice(0, 300).map(rule => ({ domain: normalizeDomain(rule.domain), category: rule.category.slice(0, 40) })) : [],
    excluded: Array.isArray(raw.excluded) ? [...new Set(raw.excluded.map(normalizeDomain).filter(Boolean))].slice(0, 100) : [],
    categorySchemaVersion: CATEGORY_SCHEMA_VERSION
  };
}
export function classify(tab, settings) {
  if (tab.pinned || tab.incognito) return null;
  let url;
  try { url = new URL(tab.pendingUrl || tab.url); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.replace(/^www\./, "").replace(/\.$/, "");
  if (settings.excluded.some(domain => matchesDomain(host, domain))) return null;
  if (settings.mode === "smart") {
    const categories = settings.categories || DEFAULT_CATEGORIES;
    const rule = (settings.siteRules || []).filter(rule => matchesDomain(host, rule.domain)).sort((a, b) => b.domain.length - a.domain.length)[0];
    const remembered = rule && categories.find(category => category.title === rule.category);
    if (remembered) return { key: `topic:${remembered.title}`, title: remembered.title, groupTitle: categoryGroupTitle(remembered), color: remembered.color, reason: "Your website rule" };
    const topic = (settings.categories || DEFAULT_CATEGORIES).flatMap(({ title, color, domains }) => domains.map(domain => ({ title, color, domain }))).filter(item => matchesDomain(host, item.domain)).sort((a, b) => b.domain.length - a.domain.length)[0];
    if (topic) {
      const category = categories.find(item => item.title === topic.title) || topic;
      return { key: `topic:${topic.title}`, title: topic.title, groupTitle: categoryGroupTitle(category), color: topic.color, reason: `Website: ${topic.domain}` };
    }
    const inferred = inferCategory(tab, url, categories);
    if (inferred) return { key: `topic:${inferred.title}`, title: inferred.title, groupTitle: categoryGroupTitle(inferred), color: inferred.color, reason: "Tab title, site description, and address" };
    if (settings.collectLoose) return { key: "topic:Browsing", title: "Browsing", groupTitle: "🧭 Browsing", color: "grey" };
  }
  // Exact hostnames avoid accidentally merging unrelated tenants or public suffixes.
  const hash = [...host].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
  return { key: `site:${host}`, title: host, color: COLORS[hash % COLORS.length] };
}

export function planWindow(tabs, groups, owned, settings) {
  const live = new Map(groups.map(group => [group.id, group]));
  const managed = owned.filter(item => {
    const group = live.get(item.id);
    return group && group.title === item.title && group.color === item.color;
  });
  const ids = new Set(managed.map(group => group.id));
  const buckets = new Map();
  const ungroup = [];
  for (const tab of tabs) {
    if (tab.groupId !== -1 && !ids.has(tab.groupId)) continue;
    const category = classify(tab, settings);
    if (!category) {
      if (ids.has(tab.groupId)) ungroup.push(tab.id);
      continue;
    }
    if (!buckets.has(category.key)) buckets.set(category.key, { ...category, tabs: [] });
    buckets.get(category.key).tabs.push(tab);
  }
  const actions = [];
  let loose = [];
  for (const bucket of buckets.values()) {
    const target = managed.find(group => group.key === bucket.key && bucket.tabs.some(tab => tab.groupId === group.id));
    if (bucket.tabs.length < (bucket.key.startsWith("topic:") ? 1 : settings.minTabs) && !target) {
      loose.push(...bucket.tabs);
      continue;
    }
    actions.push({
      ...bucket,
      groupId: target?.id,
      tabIds: bucket.tabs.filter(tab => tab.groupId !== target?.id).map(tab => tab.id),
      updateGroup: Boolean(target && (target.title !== (bucket.groupTitle || bucket.title) || target.color !== bucket.color))
    });
  }
  for (const tab of loose) if (ids.has(tab.groupId)) ungroup.push(tab.id);
  return { managed, ungroup, actions };
}

export function reconcileOwnership(tabs, groups, owned, settings) {
  const live = new Map(groups.map(group => [group.id, group]));
  const reconciled = owned.filter(item => {
    const group = live.get(item.id);
    return group && group.title === item.title && group.color === item.color;
  });
  const knownIds = new Set(reconciled.map(item => item.id));
  const categories = new Map();
  for (const category of settings.categories || DEFAULT_CATEGORIES) {
    categories.set(category.title, category);
    categories.set(categoryGroupTitle(category), category);
  }
  if (settings.mode === "smart" && settings.collectLoose) {
    const browsing = { title: "Browsing", emoji: "🧭", color: "grey" };
    categories.set("Browsing", browsing);
    categories.set(categoryGroupTitle(browsing), browsing);
  }
  for (const group of groups) {
    if (knownIds.has(group.id)) continue;
    const category = categories.get(group.title);
    if (!category || category.color !== group.color) continue;
    const members = tabs.filter(tab => tab.groupId === group.id);
    const key = `topic:${category.title}`;
    if (!members.length || !members.every(tab => classify(tab, settings)?.key === key)) continue;
    reconciled.push({ id: group.id, key, title: group.title, color: category.color });
    knownIds.add(group.id);
  }
  return reconciled;
}

export function explainWindow(tabs, groups, owned, settings) {
  const plan = planWindow(tabs, groups, owned, settings);
  const managedIds = new Set(plan.managed.map(group => group.id));
  const summary = { pinned: 0, existing: 0, ineligible: 0, eligible: 0, waiting: 0, ready: 0 };
  const readyIds = new Set(plan.actions.flatMap(action => action.tabIds));
  for (const tab of tabs) {
    if (tab.pinned) summary.pinned++;
    else if (tab.groupId !== -1 && !managedIds.has(tab.groupId)) summary.existing++;
    else if (!classify(tab, settings)) summary.ineligible++;
    else {
      summary.eligible++;
      if (readyIds.has(tab.id)) summary.ready++;
      else if (tab.groupId === -1) summary.waiting++;
    }
  }
  return summary;
}
