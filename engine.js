import { normalizeSettings, normalizeDomain, siteDomain, categoryGroupTitle, matchesDomain, classify, findDuplicateTarget, planWindow, reconcileOwnership, explainWindow } from "./grouping.js";

export function createEngine(api) {
  let queue = Promise.resolve();
  const serialize = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  async function settings() {
    return normalizeSettings((await api.storage.local.get("settings")).settings);
  }
  async function ownership() {
    return (await api.storage.session.get("owned")).owned || [];
  }
  async function newTabCandidates() {
    return (await api.storage.session.get("newTabCandidates")).newTabCandidates || {};
  }
  async function manualTabs() {
    return (await api.storage.session.get("manualTabs")).manualTabs || {};
  }
  async function manualSiteGroups() {
    return (await api.storage.session.get("manualSiteGroups")).manualSiteGroups || [];
  }
  async function syncTabPlacements() {
    const tabs = await api.tabs.query({});
    const groups = await api.tabGroups.query({});
    const liveIds = new Set(tabs.map(tab => String(tab.id)));
    const liveGroupIds = new Set(groups.map(group => group.id));
    const locked = await manualTabs();
    for (const id of Object.keys(locked)) if (!liveIds.has(id)) delete locked[id];
    await api.storage.session.set({
      tabPlacements: Object.fromEntries(tabs.map(tab => [tab.id, tab.groupId])),
      manualTabs: locked,
      manualSiteGroups: (await manualSiteGroups()).filter(rule => liveGroupIds.has(rule.groupId))
    });
    return locked;
  }
  async function learnManualSitePlacement(tabId, groupId) {
    let tab;
    try { tab = await api.tabs.get(tabId); } catch { return; }
    const domain = siteDomain(tab.pendingUrl || tab.url);
    if (!domain) return;
    const config = await settings();
    let siteRules = config.siteRules.filter(rule => !(rule.domain === domain && rule.source === "manual"));
    let groupRules = (await manualSiteGroups()).filter(rule => !(rule.domain === domain && rule.windowId === tab.windowId));
    if (groupId !== -1) {
      let group;
      try { group = await api.tabGroups.get(groupId); } catch { return; }
      const category = config.categories.find(item => group.color === item.color && (group.title === item.title || group.title === categoryGroupTitle(item)));
      const otherSiteRules = siteRules.filter(rule => rule.domain !== domain);
      if (category && otherSiteRules.length < 300) {
        siteRules = otherSiteRules;
        siteRules.push({ domain, category: category.title, source: "manual" });
      } else {
        groupRules.push({ domain, windowId: tab.windowId, groupId });
      }
    }
    await api.storage.local.set({ settings: { ...config, siteRules } });
    await api.storage.session.set({ manualSiteGroups: groupRules.slice(-300) });
  }
  async function learnExistingCategoryPlacements() {
    const config = await settings();
    const tabs = await enrichTabs(await api.tabs.query({}));
    const groups = await api.tabGroups.query({});
    const votes = new Map();
    for (const group of groups) {
      const category = config.categories.find(item => group.color === item.color && (group.title === item.title || group.title === categoryGroupTitle(item)));
      if (!category) continue;
      for (const tab of tabs.filter(item => item.groupId === group.id)) {
        if (tab.pinned || tab.incognito) continue;
        const address = tab.pendingUrl || tab.url;
        const host = normalizeDomain(address);
        const domain = siteDomain(address);
        if (!domain || config.excluded.some(item => matchesDomain(host, item)) || classify(tab, config)?.title === category.title) continue;
        if (!votes.has(domain)) votes.set(domain, new Map());
        const categories = votes.get(domain);
        categories.set(category.title, (categories.get(category.title) || 0) + 1);
      }
    }
    let siteRules = config.siteRules;
    let changed = false;
    for (const [domain, categories] of votes) {
      const ranked = [...categories].sort((a, b) => b[1] - a[1]);
      if (!ranked[0] || (ranked[1] && ranked[0][1] === ranked[1][1])) continue;
      const [category] = ranked[0];
      if (siteRules.some(rule => rule.domain === domain && rule.category === category)) continue;
      const otherRules = siteRules.filter(rule => rule.domain !== domain);
      if (otherRules.length >= 300) continue;
      siteRules = [...otherRules, { domain, category, source: "manual" }];
      changed = true;
    }
    if (changed) await api.storage.local.set({ settings: { ...config, siteRules } });
    return changed;
  }
  async function expectTabMoves(moves, tabIds, target, touched) {
    for (const id of tabIds) {
      moves[id] = { target, expiresAt: Date.now() + 10000 };
      touched.add(String(id));
    }
    await api.storage.session.set({ extensionMoves: moves });
  }
  function settleTabMoves(moves, touched) {
    const expiresAt = Date.now() + 2000;
    for (const id of touched) if (moves[id]) moves[id].expiresAt = expiresAt;
  }
  async function unchangedTabIds(tabIds, plannedTabs) {
    const planned = new Map(plannedTabs.map(tab => [tab.id, tab]));
    const current = await Promise.all(tabIds.map(async id => {
      try { return await api.tabs.get(id); } catch { return null; }
    }));
    return current.filter(tab => {
      if (!tab || tab.pinned || tab.incognito) return false;
      const before = planned.get(tab.id);
      return before && before.windowId === tab.windowId && before.groupId === tab.groupId && (before.pendingUrl || before.url) === (tab.pendingUrl || tab.url);
    }).map(tab => tab.id);
  }
  async function clearCandidate(tabId) {
    const candidates = await newTabCandidates();
    delete candidates[tabId];
    await api.storage.session.set({ newTabCandidates: candidates });
  }
  async function enrichTabs(tabs) {
    const { tabMetadata = {} } = await api.storage.session.get("tabMetadata");
    return tabs.map(tab => {
      const metadata = tabMetadata[tab.id];
      return metadata && metadata.url === (tab.pendingUrl || tab.url) ? { ...tab, description: metadata.description, siteName: metadata.siteName } : tab;
    });
  }
  async function validOwnership() {
    const groups = await api.tabGroups.query({});
    return (await ownership()).filter(item => groups.some(group => group.id === item.id && group.title === item.title && group.color === item.color));
  }
  async function organize({ windowId, force = false } = {}) {
    const config = await settings();
    if (!config.enabled && !force) return { changed: 0 };
    const windows = await api.windows.getAll({ windowTypes: ["normal"] });
    const locked = await manualTabs();
    const manualTabIds = Object.keys(locked).map(Number);
    const manualTabIdSet = new Set(manualTabIds);
    const { tabPlacements = {}, extensionMoves = {} } = await api.storage.session.get(["tabPlacements", "extensionMoves"]);
    for (const [id, move] of Object.entries(extensionMoves)) if (!move || move.expiresAt <= Date.now()) delete extensionMoves[id];
    const touchedMoves = new Set();
    const liveGroups = await api.tabGroups.query({});
    const liveGroupIds = new Set(liveGroups.map(group => group.id));
    const learnedGroups = (await manualSiteGroups()).filter(rule => liveGroupIds.has(rule.groupId));
    await api.storage.session.set({ manualSiteGroups: learnedGroups });
    let owned = await validOwnership();
    let changed = 0;
    const errors = [];
    for (const window of windows) {
      if (window.incognito || (windowId !== undefined && window.id !== windowId)) continue;
      try {
        const tabs = await enrichTabs(await api.tabs.query({ windowId: window.id }));
        const groups = await api.tabGroups.query({ windowId: window.id });
        const windowGroupIds = new Set(groups.map(group => group.id));
        const otherWindows = owned.filter(item => !windowGroupIds.has(item.id));
        const thisWindow = owned.filter(item => windowGroupIds.has(item.id));
        owned = [...otherWindows, ...reconcileOwnership(tabs, groups, thisWindow, config)];
        await api.storage.session.set({ owned });
        const managedIds = new Set(owned.map(group => group.id));
        const sitePlaced = new Set();
        const routes = new Map();
        for (const tab of tabs) {
          if (manualTabIdSet.has(tab.id) || tab.pinned || tab.incognito) continue;
          const host = normalizeDomain(tab.pendingUrl || tab.url);
          if (!host || config.excluded.some(domain => matchesDomain(host, domain))) continue;
          const rule = learnedGroups
            .filter(item => item.windowId === window.id && host && matchesDomain(host, item.domain))
            .sort((a, b) => b.domain.length - a.domain.length)[0];
          if (!rule) continue;
          if (tab.groupId !== -1 && tab.groupId !== rule.groupId && !managedIds.has(tab.groupId)) continue;
          sitePlaced.add(tab.id);
          if (tab.groupId !== rule.groupId) {
            if (!routes.has(rule.groupId)) routes.set(rule.groupId, []);
            routes.get(rule.groupId).push(tab.id);
          }
        }
        for (const [groupId, tabIds] of routes) {
          const movable = await unchangedTabIds(tabIds, tabs);
          if (!movable.length) continue;
          await expectTabMoves(extensionMoves, movable, groupId, touchedMoves);
          await api.tabs.group({ groupId, tabIds: movable });
          for (const id of movable) {
            tabPlacements[id] = groupId;
            const tab = tabs.find(item => item.id === id);
            if (tab) tab.groupId = groupId;
          }
          changed += movable.length;
        }
        const protectedTabIds = [...manualTabIdSet, ...sitePlaced];
        const plan = planWindow(tabs, groups, owned, config, protectedTabIds);
        if (plan.ungroup.length) {
          const movable = await unchangedTabIds(plan.ungroup, tabs);
          if (movable.length) {
            await expectTabMoves(extensionMoves, movable, -1, touchedMoves);
            await api.tabs.ungroup(movable);
            for (const id of movable) tabPlacements[id] = -1;
            changed += movable.length;
          }
        }
        for (const action of plan.actions) {
          if (!action.tabIds.length && !action.updateGroup) continue;
          const movable = await unchangedTabIds(action.tabIds, tabs);
          if (!movable.length && !action.updateGroup) continue;
          let groupId = action.groupId;
          const groupTitle = action.groupTitle || action.title;
          if (groupId !== undefined) {
            if (movable.length) {
              await expectTabMoves(extensionMoves, movable, groupId, touchedMoves);
              await api.tabs.group({ groupId, tabIds: movable });
              for (const id of movable) tabPlacements[id] = groupId;
            }
            if (action.updateGroup) {
              await api.tabGroups.update(groupId, { title: groupTitle, color: action.color });
              const record = owned.find(item => item.id === groupId);
              if (record) Object.assign(record, { title: groupTitle, color: action.color });
              await api.storage.session.set({ owned });
            }
          } else {
            await expectTabMoves(extensionMoves, movable, null, touchedMoves);
            groupId = await api.tabs.group({ createProperties: { windowId: window.id }, tabIds: movable });
            for (const id of movable) {
              tabPlacements[id] = groupId;
              extensionMoves[id].target = groupId;
            }
            await api.storage.session.set({ extensionMoves });
            const record = { id: groupId, key: action.key, title: groupTitle, color: action.color };
            // Record ownership before further mutations so failures can be recovered.
            owned.push(record);
            await api.storage.session.set({ owned });
            try {
              await api.tabGroups.update(groupId, {
                title: groupTitle, color: action.color,
                collapsed: config.collapse && !action.tabs.some(tab => tab.active)
              });
            } catch (error) {
              // Return a partially-created group to ungrouped tabs so a later pass can retry.
              const members = await api.tabs.query({ groupId });
              if (members.length) {
                await expectTabMoves(extensionMoves, members.map(tab => tab.id), -1, touchedMoves);
                await api.tabs.ungroup(members.map(tab => tab.id));
                for (const tab of members) tabPlacements[tab.id] = -1;
              }
              throw error;
            }
          }
          changed += movable.length + Number(action.updateGroup);
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
    // Prune groups removed by moves, tab closures, or user edits.
    owned = await validOwnership();
    settleTabMoves(extensionMoves, touchedMoves);
    await api.storage.session.set({ owned, tabPlacements, extensionMoves, lastRun: { at: Date.now(), changed, errors } });
    return { changed, errors };
  }
  return {
    initialize: () => serialize(async () => {
      await learnExistingCategoryPlacements();
      return syncTabPlacements();
    }),
    organize: options => serialize(() => organize(options)),
    save: config => serialize(async () => {
      const saved = normalizeSettings(config);
      await api.storage.local.set({ settings: saved });
      const result = await organize();
      if (result.errors?.length) throw new Error("Preferences saved, but some tabs were busy. Try Organize again in a moment.");
      return saved;
    }),
    remember: (domainInput, category) => serialize(async () => {
      const config = await settings();
      const domain = normalizeDomain(domainInput);
      if (!domain || !config.categories.some(item => item.title === category)) throw new Error("Choose a website and a category first.");
      const siteRules = config.siteRules.filter(rule => rule.domain !== domain);
      siteRules.push({ domain, category });
      if (siteRules.length > 300) throw new Error("You have reached 300 website rules. Remove a rule in Manage categories first.");
      await api.storage.local.set({ settings: { ...config, siteRules } });
      const result = await organize({ force: true });
      if (result.errors?.length) throw new Error(`Website rule saved. Chrome could not finish grouping: ${result.errors.join("; ")}`);
    }),
    trackNewTab: (tabId, groupId = -1) => serialize(async () => {
      if (!Number.isInteger(tabId)) return;
      const candidates = await newTabCandidates();
      candidates[tabId] = Date.now();
      const { tabPlacements = {} } = await api.storage.session.get("tabPlacements");
      tabPlacements[tabId] = Number.isInteger(groupId) ? groupId : -1;
      await api.storage.session.set({ newTabCandidates: candidates, tabPlacements });
    }),
    groupChanged: (tabId, groupId) => serialize(async () => {
      if (!Number.isInteger(tabId) || !Number.isInteger(groupId)) return false;
      const { tabPlacements = {}, manualTabs: locked = {}, extensionMoves = {} } = await api.storage.session.get(["tabPlacements", "manualTabs", "extensionMoves"]);
      const expected = extensionMoves[tabId];
      if (expected && expected.expiresAt > Date.now()) {
        let extensionChange = expected.target === null || groupId === expected.target;
        if (!extensionChange && groupId === -1 && expected.target !== -1) {
          try { extensionChange = (await api.tabs.get(tabId)).groupId === expected.target; } catch {}
        }
        if (extensionChange) {
          tabPlacements[tabId] = expected.target === null ? groupId : expected.target;
          await api.storage.session.set({ tabPlacements, extensionMoves });
          return false;
        }
      }
      delete extensionMoves[tabId];
      const previous = tabPlacements[tabId];
      const changedByUser = previous === undefined || previous !== groupId;
      tabPlacements[tabId] = groupId;
      if (changedByUser) {
        locked[tabId] = groupId;
        await learnManualSitePlacement(tabId, groupId);
      }
      await api.storage.session.set({ tabPlacements, manualTabs: locked, extensionMoves });
      return changedByUser;
    }),
    reuseDuplicate: tabId => serialize(async () => {
      const candidates = await newTabCandidates();
      if (!candidates[tabId]) return false;
      let current;
      try { current = await api.tabs.get(tabId); } catch {
        await clearCandidate(tabId);
        return false;
      }
      if (current.status !== "complete") return false;
      await clearCandidate(tabId);
      if (!(await settings()).reuseDuplicates) return false;
      if (Object.hasOwn(await manualTabs(), tabId)) return false;
      const tabs = await api.tabs.query({ windowId: current.windowId });
      const target = findDuplicateTarget(current, tabs);
      if (!target) return false;
      if (current.active) await api.tabs.update(target.id, { active: true });
      await api.tabs.remove(tabId);
      const { duplicateCount = 0 } = await api.storage.session.get("duplicateCount");
      await api.storage.session.set({ duplicateCount: duplicateCount + 1 });
      return true;
    }),
    pageMetadata: (tabId, url, windowId, input) => serialize(async () => {
      if (!Number.isInteger(tabId) || !/^https?:\/\//.test(url)) return;
      const clean = value => String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      const { tabMetadata = {} } = await api.storage.session.get("tabMetadata");
      tabMetadata[tabId] = {
        url,
        description: clean(input.description).slice(0, 600),
        siteName: clean(input.siteName).slice(0, 100)
      };
      const entries = Object.entries(tabMetadata);
      if (entries.length > 500) {
        for (const [id] of entries.slice(0, entries.length - 500)) delete tabMetadata[id];
      }
      await api.storage.session.set({ tabMetadata });
      return organize({ windowId });
    }),
    forgetTab: tabId => serialize(async () => {
      const { tabMetadata = {}, tabPlacements = {}, manualTabs: locked = {}, extensionMoves = {} } = await api.storage.session.get(["tabMetadata", "tabPlacements", "manualTabs", "extensionMoves"]);
      delete tabMetadata[tabId];
      delete tabPlacements[tabId];
      delete locked[tabId];
      delete extensionMoves[tabId];
      const candidates = await newTabCandidates();
      delete candidates[tabId];
      await api.storage.session.set({ tabMetadata, tabPlacements, manualTabs: locked, extensionMoves, newTabCandidates: candidates });
    }),
    status: windowId => serialize(async () => {
      const config = await settings();
      const tabs = await enrichTabs(await api.tabs.query({ windowId }));
      const groups = await api.tabGroups.query({ windowId });
      const owned = await validOwnership();
      const locked = await manualTabs();
      const manualTabIds = Object.keys(locked).map(Number);
      const { lastRun, duplicateCount = 0 } = await api.storage.session.get(["lastRun", "duplicateCount"]);
      return {
        settings: config, total: tabs.length, grouped: tabs.filter(tab => tab.groupId !== -1).length,
        diagnostics: explainWindow(tabs, groups, owned, config, manualTabIds),
        websites: [...new Set(tabs.filter(tab => !tab.pinned && classify(tab, config)).map(tab => normalizeDomain(tab.pendingUrl || tab.url)).filter(Boolean))].sort().map(domain => {
          const tab = tabs.find(tab => normalizeDomain(tab.pendingUrl || tab.url) === domain);
          const category = classify(tab, config);
          return { domain, category: category?.title, reason: category?.reason || "Unrecognized website", active: tabs.some(item => item.active && normalizeDomain(item.pendingUrl || item.url) === domain) };
        }),
        groups: groups.map(group => ({ ...group, count: tabs.filter(tab => tab.groupId === group.id).length, managed: owned.some(item => item.id === group.id) })),
        duplicateCount,
        lastRun
      };
    }),
    release: () => serialize(async () => {
      await api.storage.local.set({ settings: { ...await settings(), enabled: false } });
      const owned = await validOwnership();
      const locked = new Set(Object.keys(await manualTabs()).map(Number));
      const { tabPlacements = {}, extensionMoves = {} } = await api.storage.session.get(["tabPlacements", "extensionMoves"]);
      const touchedMoves = new Set();
      for (const group of owned) {
        const tabs = await api.tabs.query({ groupId: group.id });
        const releasable = tabs.filter(tab => !locked.has(tab.id)).map(tab => tab.id);
        if (releasable.length) {
          await expectTabMoves(extensionMoves, releasable, -1, touchedMoves);
          await api.tabs.ungroup(releasable);
          for (const id of releasable) tabPlacements[id] = -1;
        }
      }
      settleTabMoves(extensionMoves, touchedMoves);
      await api.storage.session.set({ owned: [], tabPlacements, extensionMoves });
    }),
    toggleGroup: (id, windowId) => serialize(async () => {
      const group = await api.tabGroups.get(id);
      if (group.windowId !== windowId) throw new Error("This group moved to another window. Reopen Tabnest.");
      await api.tabGroups.update(id, { collapsed: !group.collapsed });
    })
  };
}
