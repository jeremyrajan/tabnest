import { normalizeSettings, normalizeDomain, classify, findDuplicateTarget, planWindow, reconcileOwnership, explainWindow } from "./grouping.js";

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
        const plan = planWindow(tabs, groups, owned, config);
        if (plan.ungroup.length) {
          await api.tabs.ungroup(plan.ungroup);
          changed += plan.ungroup.length;
        }
        for (const action of plan.actions) {
          if (!action.tabIds.length && !action.updateGroup) continue;
          let groupId = action.groupId;
          const groupTitle = action.groupTitle || action.title;
          if (groupId !== undefined) {
            if (action.tabIds.length) await api.tabs.group({ groupId, tabIds: action.tabIds });
            if (action.updateGroup) {
              await api.tabGroups.update(groupId, { title: groupTitle, color: action.color });
              const record = owned.find(item => item.id === groupId);
              if (record) Object.assign(record, { title: groupTitle, color: action.color });
              await api.storage.session.set({ owned });
            }
          } else {
            groupId = await api.tabs.group({ createProperties: { windowId: window.id }, tabIds: action.tabIds });
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
              if (members.length) await api.tabs.ungroup(members.map(tab => tab.id));
              throw error;
            }
          }
          changed += action.tabIds.length + Number(action.updateGroup);
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
    // Prune groups removed by moves, tab closures, or user edits.
    owned = await validOwnership();
    await api.storage.session.set({ owned, lastRun: { at: Date.now(), changed, errors } });
    return { changed, errors };
  }
  return {
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
    trackNewTab: tabId => serialize(async () => {
      if (!Number.isInteger(tabId)) return;
      const candidates = await newTabCandidates();
      candidates[tabId] = Date.now();
      await api.storage.session.set({ newTabCandidates: candidates });
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
    forgetMetadata: tabId => serialize(async () => {
      const { tabMetadata = {} } = await api.storage.session.get("tabMetadata");
      delete tabMetadata[tabId];
      const candidates = await newTabCandidates();
      delete candidates[tabId];
      await api.storage.session.set({ tabMetadata, newTabCandidates: candidates });
    }),
    status: windowId => serialize(async () => {
      const config = await settings();
      const tabs = await enrichTabs(await api.tabs.query({ windowId }));
      const groups = await api.tabGroups.query({ windowId });
      const owned = await validOwnership();
      const { lastRun, duplicateCount = 0 } = await api.storage.session.get(["lastRun", "duplicateCount"]);
      return {
        settings: config, total: tabs.length, grouped: tabs.filter(tab => tab.groupId !== -1).length,
        diagnostics: explainWindow(tabs, groups, owned, config),
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
      for (const group of owned) {
        const tabs = await api.tabs.query({ groupId: group.id });
        if (tabs.length) await api.tabs.ungroup(tabs.map(tab => tab.id));
      }
      await api.storage.session.set({ owned: [] });
    }),
    toggleGroup: (id, windowId) => serialize(async () => {
      const group = await api.tabGroups.get(id);
      if (group.windowId !== windowId) throw new Error("This group moved to another window. Reopen Tabnest.");
      await api.tabGroups.update(id, { collapsed: !group.collapsed });
    })
  };
}
