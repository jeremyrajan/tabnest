import test from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../engine.js";

function fixture() {
  let nextId = 100;
  const state = { tabs: [], groups: [], local: {}, session: {}, calls: [] };
  const area = key => ({
    get: async names => {
      const keys = Array.isArray(names) ? names : [names];
      return Object.fromEntries(keys.map(name => [name, structuredClone(state[key][name])]));
    },
    set: async values => Object.assign(state[key], structuredClone(values))
  });
  const api = {
    storage: { local: area("local"), session: area("session") },
    windows: { getAll: async () => [{ id: 1 }, { id: 2 }] },
    tabs: {
      query: async query => state.tabs.filter(tab => Object.entries(query).every(([key, value]) => tab[key] === value)).map(tab => ({ ...tab })),
      get: async id => {
        const found = state.tabs.find(tab => tab.id === id);
        if (!found) throw new Error("No tab with id");
        return { ...found };
      },
      update: async (id, update) => {
        const found = state.tabs.find(tab => tab.id === id);
        if (!found) throw new Error("No tab with id");
        if (update.active) state.tabs.filter(tab => tab.windowId === found.windowId).forEach(tab => { tab.active = false; });
        Object.assign(found, update);
        return { ...found };
      },
      remove: async id => {
        const index = state.tabs.findIndex(tab => tab.id === id);
        if (index < 0) throw new Error("No tab with id");
        state.tabs.splice(index, 1);
        state.groups = state.groups.filter(group => state.tabs.some(tab => tab.groupId === group.id));
      },
      group: async options => {
        state.calls.push(options);
        const groupId = options.groupId ?? nextId++;
        if (options.groupId === undefined) state.groups.push({ id: groupId, windowId: options.createProperties.windowId, title: "", color: "grey" });
        else assert.ok(state.groups.some(group => group.id === groupId));
        for (const id of options.tabIds) {
          const tab = state.tabs.find(item => item.id === id);
          assert.equal(tab.windowId, state.groups.find(group => group.id === groupId).windowId);
          tab.groupId = groupId;
        }
        state.groups = state.groups.filter(group => state.tabs.some(tab => tab.groupId === group.id));
        return groupId;
      },
      ungroup: async ids => {
        state.tabs.filter(tab => ids.includes(tab.id)).forEach(tab => { tab.groupId = -1; });
        state.groups = state.groups.filter(group => state.tabs.some(tab => tab.groupId === group.id));
      }
    },
    tabGroups: {
      query: async query => state.groups.filter(group => Object.entries(query).every(([key, value]) => group[key] === value)).map(group => ({ ...group })),
      get: async id => state.groups.find(group => group.id === id),
      update: async (id, update) => Object.assign(state.groups.find(group => group.id === id), update)
    }
  };
  const add = (id, windowId, extra = {}) => state.tabs.push({ id, windowId, url: "https://github.com/test", groupId: -1, active: false, pinned: false, incognito: false, status: "complete", index: state.tabs.filter(tab => tab.windowId === windowId).length, ...extra });
  return { state, api, add, engine: createEngine(api) };
}
test("organization is per window, idempotent, and keeps active groups expanded", async () => {
  const { state, add, engine } = fixture();
  add(1, 1, { active: true }); add(2, 1); add(3, 2); add(4, 2);
  assert.equal((await engine.organize()).changed, 4);
  assert.equal(state.groups.length, 2);
  assert.equal(state.groups[0].collapsed, false);
  assert.equal(state.groups[1].collapsed, true);
  assert.equal((await engine.organize()).changed, 0);
  assert.equal(state.calls.length, 2);
});
test("ownership survives a fresh service worker and new tabs join existing groups", async () => {
  const { state, api, add, engine } = fixture();
  add(1, 1); add(2, 1);
  await engine.organize();
  add(3, 1);
  await createEngine(api).organize();
  assert.equal(state.groups.length, 1);
  assert.equal(state.tabs[2].groupId, state.tabs[0].groupId);
});
test("pause blocks automatic grouping but allows explicit grouping of one window", async () => {
  const { state, add, engine } = fixture();
  add(1, 1); add(2, 1); add(3, 2); add(4, 2);
  await engine.save({ enabled: false });
  await engine.organize();
  assert.equal(state.groups.length, 0);
  await engine.organize({ force: true, windowId: 2 });
  assert.equal(state.groups.length, 1);
  assert.equal(state.tabs[0].groupId, -1);
});
test("release removes only owned groups and pauses future grouping", async () => {
  const { state, add, engine } = fixture();
  add(1, 1); add(2, 1); add(3, 1, { groupId: 50 });
  state.groups.push({ id: 50, windowId: 1, title: "Mine", color: "red" });
  await engine.organize();
  await engine.release();
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].id, 50);
  assert.equal(state.local.settings.enabled, false);
  await engine.organize();
  assert.equal(state.tabs[0].groupId, -1);
});
test("concurrent triggers are serialized without duplicate groups", async () => {
  const { state, add, engine } = fixture();
  add(1, 1); add(2, 1);
  await Promise.all([engine.organize(), engine.organize(), engine.organize()]);
  assert.equal(state.groups.length, 1);
  assert.equal(state.calls.length, 1);
});

test("remembered website corrections reclassify managed tabs", async () => {
  const { state, add, engine } = fixture();
  add(1, 1, { url: "https://unknown.test/one", title: "Unknown" });
  add(2, 1, { url: "https://unknown.test/two", title: "Unknown" });
  await engine.organize();
  assert.equal(state.groups[0].title, "🧭 Browsing");
  await engine.remember("unknown.test", "Developer");
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].title, "💻 Developer");
  assert.deepEqual(state.local.settings.siteRules, [{ domain: "unknown.test", category: "Developer" }]);
});

test("changing a category color updates its existing managed group", async () => {
  const { state, add, engine } = fixture();
  add(1, 1); add(2, 1);
  await engine.organize();
  const settings = state.local.settings || (await engine.status(1)).settings;
  const categories = settings.categories.map(category => category.title === "Developer" ? { ...category, color: "red" } : category);
  await engine.save({ ...settings, categories });
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].color, "red");
  assert.equal(state.session.owned[0].color, "red");
});

test("page metadata reclassifies an unclear tab and is cleared when it closes", async () => {
  const { state, add, engine } = fixture();
  add(1, 1, { url: "https://described.test/product", title: "Acme" });
  await engine.organize();
  assert.equal(state.groups[0].title, "🧭 Browsing");
  await engine.pageMetadata(1, "https://described.test/product", 1, {
    description: "Watch video online with curated episodes",
    siteName: "Acme"
  });
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].title, "🎬 Media");
  assert.equal(state.session.tabMetadata[1].description, "Watch video online with curated episodes");
  await engine.forgetTab(1);
  assert.equal(state.session.tabMetadata[1], undefined);
});

test("manual tab placement is remembered until that tab closes", async () => {
  const { state, add, engine } = fixture();
  add(1, 1, { url: "https://github.com/one" });
  add(2, 1, { url: "https://gitlab.com/two" });
  add(3, 1, { url: "https://docs.google.com/document/three" });
  add(4, 1, { url: "https://notion.so/four" });
  await engine.organize();
  const developerId = state.tabs.find(tab => tab.id === 1).groupId;
  const workId = state.tabs.find(tab => tab.id === 3).groupId;
  assert.equal(await engine.groupChanged(1, developerId), false);
  state.tabs.find(tab => tab.id === 1).groupId = workId;
  assert.equal(await engine.groupChanged(1, workId), true);
  await engine.organize();
  assert.equal(state.tabs.find(tab => tab.id === 1).groupId, workId);
  assert.equal(state.session.manualTabs[1], workId);
  await engine.release();
  assert.equal(state.tabs.find(tab => tab.id === 1).groupId, workId);
  await engine.forgetTab(1);
  assert.equal(state.session.manualTabs[1], undefined);
  assert.equal(state.session.tabPlacements[1], undefined);
});

test("moving a website into a category teaches future matching tabs", async () => {
  const { state, api, add, engine } = fixture();
  add(1, 1, { url: "https://xyz.test/first", title: "Unknown" });
  add(2, 1, { url: "https://docs.google.com/document/work" });
  await engine.organize();
  const workId = state.tabs.find(tab => tab.id === 2).groupId;
  await api.tabs.group({ groupId: workId, tabIds: [1] });
  await engine.groupChanged(1, workId);
  assert.deepEqual(state.local.settings.siteRules, [{ domain: "xyz.test", category: "Work", source: "manual" }]);
  await api.tabs.remove(1);
  await engine.forgetTab(1);
  add(3, 1, { url: "https://app.xyz.test/future", title: "Unknown" });
  await engine.organize();
  assert.equal(state.tabs.find(tab => tab.id === 3).groupId, workId);
  assert.equal(state.session.manualTabs[1], undefined);
  assert.equal(state.local.settings.siteRules[0].domain, "xyz.test");
});

test("moving a website into a custom group routes future tabs while that group exists", async () => {
  const { state, api, add, engine } = fixture();
  add(1, 1, { url: "https://xyz.test/first", title: "Unknown" });
  add(2, 1, { url: "https://project.test/home", groupId: 50 });
  state.groups.push({ id: 50, windowId: 1, title: "My project", color: "red" });
  await engine.save({ collectLoose: false });
  await api.tabs.group({ groupId: 50, tabIds: [1] });
  await engine.groupChanged(1, 50);
  assert.deepEqual(state.session.manualSiteGroups, [{ domain: "xyz.test", windowId: 1, groupId: 50 }]);
  add(3, 1, { url: "https://sub.xyz.test/future", title: "Unknown" });
  await engine.organize();
  assert.equal(state.tabs.find(tab => tab.id === 3).groupId, 50);
});

test("duplicate category groups left by an extension reload are merged", async () => {
  const { state, add, engine } = fixture();
  add(1, 1, { groupId: 50, url: "https://github.com" });
  add(2, 1, { groupId: 51, url: "https://app.posthog.com" });
  state.groups.push(
    { id: 50, windowId: 1, title: "Developer", color: "purple" },
    { id: 51, windowId: 1, title: "Developer", color: "purple" }
  );
  await engine.organize();
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].title, "💻 Developer");
  assert.equal(state.tabs[0].groupId, state.tabs[1].groupId);
  assert.equal(state.session.owned.length, 1);
});

test("a newly loaded exact URL reuses the older tab", async () => {
  const { state, add, engine } = fixture();
  add(1, 1, { url: "https://github.com/project?q=1#readme", active: false });
  add(2, 1, { url: "https://github.com/project?q=1#readme", active: true });
  await engine.trackNewTab(2);
  assert.equal(await engine.reuseDuplicate(2), true);
  assert.deepEqual(state.tabs.map(tab => tab.id), [1]);
  assert.equal(state.tabs[0].active, true);
  assert.equal(state.session.duplicateCount, 1);
});

test("a manually placed new tab is not closed as a duplicate", async () => {
  const { state, add, engine } = fixture();
  add(1, 1, { url: "https://github.com/project", groupId: 50 });
  add(2, 1, { url: "https://github.com/project", active: true });
  state.groups.push({ id: 50, windowId: 1, title: "My project", color: "blue" });
  await engine.trackNewTab(2, -1);
  state.tabs.find(tab => tab.id === 2).groupId = 50;
  await engine.groupChanged(2, 50);
  assert.equal(await engine.reuseDuplicate(2), false);
  assert.deepEqual(state.tabs.map(tab => tab.id), [1, 2]);
});

test("established tabs, distinct URLs, and disabled reuse are preserved", async () => {
  const { state, add, engine } = fixture();
  add(1, 1, { url: "https://github.com/project?q=1" });
  add(2, 1, { url: "https://github.com/project?q=2", active: true });
  assert.equal(await engine.reuseDuplicate(2), false);
  await engine.trackNewTab(2);
  assert.equal(await engine.reuseDuplicate(2), false);
  assert.equal(state.tabs.length, 2);
  const current = (await engine.status(1)).settings;
  await engine.save({ ...current, reuseDuplicates: false });
  add(3, 1, { url: "https://github.com/project?q=1", active: true });
  await engine.trackNewTab(3);
  assert.equal(await engine.reuseDuplicate(3), false);
  assert.equal(state.tabs.length, 3);
});
