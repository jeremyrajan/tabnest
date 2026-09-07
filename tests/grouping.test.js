import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, classify, exactWebUrl, findDuplicateTarget, normalizeDomain, siteDomain, normalizeSettings, planWindow, reconcileOwnership, explainWindow } from "../grouping.js";

const tab = (id, url, extra = {}) => ({ id, url, groupId: -1, windowId: 1, ...extra });
test("smart categories, domain boundaries, and exact website fallback", () => {
  assert.equal(classify(tab(1, "https://docs.google.com/document/1"), DEFAULTS).title, "Work");
  assert.equal(classify(tab(1, "https://github.com/org/repo"), DEFAULTS).title, "Developer");
  assert.equal(classify(tab(1, "https://notgithub.com"), DEFAULTS).title, "Browsing");
  assert.equal(classify(tab(1, "https://www.example.co.uk/a"), { ...DEFAULTS, mode: "site" }).key, "site:example.co.uk");
  assert.notEqual(classify(tab(1, "https://a.github.io"), { ...DEFAULTS, mode: "site" }).key, classify(tab(2, "https://b.github.io"), { ...DEFAULTS, mode: "site" }).key);
  assert.equal(classify(tab(1, "https://docs.google.com"), { ...DEFAULTS, mode: "site" }).title, "docs.google.com");
});
test("pinned, incognito, internal, invalid and excluded tabs are skipped", () => {
  for (const t of [tab(1, "chrome://settings"), tab(2, "file:///test"), tab(3, "bad"), tab(4, "https://example.com", { pinned: true }), tab(5, "https://example.com", { incognito: true })]) assert.equal(classify(t, DEFAULTS), null);
  assert.equal(classify(tab(1, "https://sub.example.com"), { ...DEFAULTS, excluded: ["example.com"] }), null);
  assert.ok(classify(tab(1, "https://notexample.com"), { ...DEFAULTS, excluded: ["example.com"] }));
});
test("exact URL duplicate matching stays within the current window", () => {
  const current = tab(5, "https://example.com:443/path?q=1#section", { index: 4 });
  const target = findDuplicateTarget(current, [
    tab(1, "https://example.com/path?q=1#section", { index: 1 }),
    tab(2, "https://example.com/path?q=2#section", { index: 2 }),
    tab(3, "https://example.com/path?q=1#other", { index: 3 }),
    tab(4, "https://example.com/path?q=1#section", { windowId: 2, index: 0 })
  ]);
  assert.equal(target.id, 1);
  assert.equal(exactWebUrl("chrome://settings"), null);
  assert.equal(findDuplicateTarget({ ...current, pinned: true }, [target]), null);
});
test("settings and exclusions are normalized", () => {
  assert.equal(normalizeDomain("https://www.Example.com/path"), "example.com");
  assert.equal(normalizeDomain("*.example.com"), "example.com");
  assert.equal(normalizeDomain("this is not a domain"), null);
  assert.equal(normalizeDomain("chrome://settings"), null);
  assert.deepEqual(normalizeSettings({ minTabs: 999, excluded: ["Example.com", "www.example.com"] }), { ...DEFAULTS, excluded: ["example.com"] });
});
test("learned website domains include ordinary subdomains without merging hosted tenants", () => {
  assert.equal(siteDomain("https://api.dynoyard.app/keys"), "dynoyard.app");
  assert.equal(siteDomain("https://sub.example.co.uk/path"), "example.co.uk");
  assert.equal(siteDomain("https://docs.project.github.io/path"), "project.github.io");
  assert.equal(siteDomain("http://127.0.0.1:3000"), "127.0.0.1");
});
test("existing category catalogs receive Education once without overriding later removal", () => {
  const legacy = [{ title: "Developer", color: "purple", domains: ["github.com"], keywords: [] }];
  assert.ok(normalizeSettings({ categories: legacy, categorySchemaVersion: 1 }).categories.some(category => category.title === "Education"));
  assert.equal(normalizeSettings({ categories: legacy, categorySchemaVersion: 3 }).categories.some(category => category.title === "Education"), false);
});
test("category singletons group immediately; manual groups remain untouched", () => {
  const tabs = [tab(1, "https://github.com/a"), tab(2, "https://github.com/b"), tab(3, "https://figma.com"), tab(4, "https://github.com/c", { groupId: 50 })];
  const result = planWindow(tabs, [{ id: 50, title: "My project", color: "blue" }], [], DEFAULTS);
  assert.equal(result.actions.length, 2);
  assert.deepEqual(result.actions[0].tabIds, [1, 2]);
  assert.equal(result.actions[1].title, "Design");
});
test("tabs placed manually stay put and still anchor their managed group", () => {
  const owned = [{ id: 10, title: "💻 Developer", color: "purple", key: "topic:Developer" }];
  const tabs = [
    tab(1, "https://youtube.com/watch/1", { groupId: 10 }),
    tab(2, "https://gitlab.com/project")
  ];
  const result = planWindow(tabs, [{ id: 10, title: "💻 Developer", color: "purple" }], owned, DEFAULTS, [1]);
  assert.deepEqual(result.ungroup, []);
  assert.equal(result.actions[0].groupId, 10);
  assert.deepEqual(result.actions[0].tabIds, [2]);
  assert.equal(explainWindow(tabs, [{ id: 10, title: "💻 Developer", color: "purple" }], owned, DEFAULTS, [1]).manual, 1);
});
test("joins managed groups and releases tabs that navigate to excluded sites", () => {
  const owned = [{ id: 10, title: "Developer", color: "purple", key: "topic:Developer" }];
  const tabs = [tab(1, "https://github.com", { groupId: 10 }), tab(2, "https://gitlab.com"), tab(3, "https://example.com", { groupId: 10 })];
  const result = planWindow(tabs, owned, owned, { ...DEFAULTS, excluded: ["example.com"] });
  assert.deepEqual(result.ungroup, [3]);
  assert.equal(result.actions[0].groupId, 10);
  assert.deepEqual(result.actions[0].tabIds, [2]);
});
test("renaming a managed group hands it back to the user", () => {
  const owned = [{ id: 10, title: "Developer", color: "purple", key: "topic:Developer" }];
  const result = planWindow([tab(1, "https://github.com", { groupId: 10 })], [{ ...owned[0], title: "My project" }], owned, DEFAULTS);
  assert.equal(result.managed.length, 0);
  assert.equal(result.actions.length, 0);
  assert.equal(result.ungroup.length, 0);
});
test("a managed tab navigating to an unrelated singleton leaves its old group", () => {
  const owned = [{ id: 10, title: "Developer", color: "purple", key: "topic:Developer" }];
  const result = planWindow([tab(1, "https://github.com", { groupId: 10 }), tab(2, "https://example.com", { groupId: 10 })], owned, owned, { ...DEFAULTS, collectLoose: false });
  assert.deepEqual(result.ungroup, [2]);
  assert.equal(result.actions[0].groupId, 10);
});

test("six unrelated websites form a Browsing group with default settings", () => {
  const tabs = Array.from({ length: 6 }, (_, id) => tab(id, `https://site${id}.test`));
  const plan = planWindow(tabs, [], [], DEFAULTS);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].title, "Browsing");
  assert.deepEqual(plan.actions[0].tabIds, [0, 1, 2, 3, 4, 5]);
  assert.equal(explainWindow(tabs, [], [], DEFAULTS).ready, 6);
});
test("strict settings explain unmatched tabs instead of silently claiming success", () => {
  const tabs = [tab(1, "https://one.test"), tab(2, "https://two.test")];
  for (const settings of [{ ...DEFAULTS, collectLoose: false }, { ...DEFAULTS, mode: "site" }]) {
    assert.equal(planWindow(tabs, [], [], settings).actions.length, 0);
    assert.equal(explainWindow(tabs, [], [], settings).waiting, 2);
  }
});
test("unfamiliar sites classify by context and remembered corrections take precedence", () => {
  const t = tab(1, "https://unknown.test", { title: "API documentation for a new tool" });
  assert.equal(classify(t, DEFAULTS).title, "Developer");
  assert.equal(classify(tab(2, "https://new.test", { title: "A new AI assistant" }), DEFAULTS).title, "AI Apps");
  assert.equal(classify(tab(3, "https://another.test", { title: "Book flights for your trip" }), DEFAULTS).title, "Travel");
  assert.equal(classify(t, { ...DEFAULTS, siteRules: [{ domain: "unknown.test", category: "Work" }] }).title, "Work");
});

test("site descriptions classify tabs whose titles are unclear", () => {
  const tabWithDescription = tab(1, "https://unknown.test/product", {
    title: "Acme",
    description: "An AI assistant for drafting and research"
  });
  const result = classify(tabWithDescription, DEFAULTS);
  assert.equal(result.title, "AI Apps");
  assert.match(result.reason, /description/);
});

test("custom categories work for new domains and title keywords", () => {
  const categories = [...DEFAULTS.categories, { title: "My hobby", color: "orange", domains: ["hobby.test"], keywords: ["handmade pottery"] }];
  assert.equal(classify(tab(1, "https://hobby.test"), { ...DEFAULTS, categories }).title, "My hobby");
  assert.equal(classify(tab(2, "https://unknown.test", { title: "Handmade pottery inspiration" }), { ...DEFAULTS, categories }).title, "My hobby");
});

test("specific Google services beat broad google.com rules", () => {
  for (const [host, category] of [["aistudio.google.com", "AI Apps"], ["mail.google.com", "Mail"], ["console.cloud.google.com", "Developer"], ["meet.google.com", "Communication"], ["google.com", "Research & Learning"]]) {
    assert.equal(classify(tab(1, `https://${host}`), DEFAULTS).title, category);
  }
});

test("SlateTale is Education and PostHog is Developer", () => {
  assert.equal(classify(tab(1, "https://slatetale.com"), DEFAULTS).title, "Education");
  assert.equal(classify(tab(2, "https://app.posthog.com/project/1"), DEFAULTS).title, "Developer");
  assert.equal(classify(tab(3, "https://unknown.test", { title: "Product analytics and feature flags" }), DEFAULTS).title, "Developer");
  assert.equal(classify(tab(4, "https://unknown.test", { title: "An education app for student learning" }), DEFAULTS).title, "Education");
});

test("the reported six-tab mix groups into categories, including singletons", () => {
  const tabs = [
    tab(1, "https://slatetale.com", { title: "SlateTale" }),
    tab(2, "https://clarity.microsoft.com", { title: "SlateTale pilot · Dashboards" }),
    tab(3, "https://dash.cloudflare.com/project", { title: "slatetale.com | slatetale.com" }),
    tab(4, "https://aistudio.google.com", { title: "Spend | Google AI Studio" }),
    tab(5, "https://google.com", { title: "Google" }),
    tab(6, "https://github.com", { title: "GitHub" })
  ];
  const plan = planWindow(tabs, [], [], DEFAULTS);
  assert.deepEqual(plan.actions.find(action => action.title === "Developer").tabIds, [2, 3, 6]);
  assert.deepEqual(plan.actions.find(action => action.title === "AI Apps").tabIds, [4]);
  assert.deepEqual(plan.actions.find(action => action.title === "Research & Learning").tabIds, [5]);
  assert.deepEqual(plan.actions.find(action => action.title === "Education").tabIds, [1]);
  const owned = plan.actions.map((action, i) => ({ id: i + 10, key: action.key, title: action.title, color: action.color }));
  for (const [i, action] of plan.actions.entries()) for (const t of tabs) if (action.tabIds.includes(t.id)) t.groupId = i + 10;
  assert.ok(planWindow(tabs, owned, owned, DEFAULTS).actions.every(action => action.tabIds.length === 0));
});

test("generic or tied title signals fall back instead of forcing a category", () => {
  assert.equal(classify(tab(1, "https://unknown.test", { title: "Dashboard · Settings" }), DEFAULTS).title, "Browsing");
  assert.equal(classify(tab(2, "https://unknown.test", { title: "AI assistant and API documentation" }), DEFAULTS).title, "Browsing");
  assert.equal(classify(tab(3, "https://unknown.test/?q=API%20documentation"), DEFAULTS).title, "Browsing");
});

test("matching category groups are safely recognized after an extension reload", () => {
  const tabs = [
    tab(1, "https://github.com", { groupId: 10 }),
    tab(2, "https://app.posthog.com", { groupId: 11 })
  ];
  const groups = [
    { id: 10, title: "Developer", color: "purple" },
    { id: 11, title: "Developer", color: "purple" }
  ];
  const owned = reconcileOwnership(tabs, groups, [], DEFAULTS);
  assert.deepEqual(owned.map(group => group.id), [10, 11]);
  const plan = planWindow(tabs, groups, owned, DEFAULTS);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].groupId, 10);
  assert.deepEqual(plan.actions[0].tabIds, [2]);
});

test("mixed, renamed, and recolored user groups are not adopted", () => {
  const tabs = [
    tab(1, "https://github.com", { groupId: 10 }),
    tab(2, "https://youtube.com", { groupId: 10 }),
    tab(3, "https://github.com", { groupId: 11 }),
    tab(4, "https://github.com", { groupId: 12 })
  ];
  const groups = [
    { id: 10, title: "Developer", color: "purple" },
    { id: 11, title: "My project", color: "purple" },
    { id: 12, title: "Developer", color: "blue" }
  ];
  assert.deepEqual(reconcileOwnership(tabs, groups, [], DEFAULTS), []);
});
