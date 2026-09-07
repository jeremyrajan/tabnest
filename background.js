import { createEngine } from "./engine.js";

const engine = createEngine(chrome);
const ALARM = "tabnest-maintenance";
let timer;
const report = error => {
  console.warn("Tabnest:", error.message);
  chrome.storage.session.set({ lastRun: { at: Date.now(), changed: 0, errors: [error.message] } }).catch(() => {});
};
function schedule() {
  // A busy tab must not postpone organization indefinitely by resetting the timer.
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    engine.organize().catch(report);
  }, 1500);
}
async function initialize() {
  await engine.initialize();
  if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  schedule();
}
chrome.runtime.onInstalled.addListener(() => initialize().catch(report));
chrome.runtime.onStartup.addListener(() => initialize().catch(report));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) engine.organize().catch(report); });
chrome.tabs.onCreated.addListener(tab => {
  engine.trackNewTab(tab.id, tab.groupId)
    .then(() => tab.status === "complete" ? engine.reuseDuplicate(tab.id) : false)
    .then(closed => { if (!closed) schedule(); })
    .catch(report);
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.groupId !== undefined) {
    engine.groupChanged(id, change.groupId).then(changedByUser => { if (changedByUser) schedule(); }).catch(report);
  }
  if (change.status === "complete") {
    engine.reuseDuplicate(id).then(closed => { if (!closed) schedule(); }).catch(report);
  } else if (change.url !== undefined || change.title !== undefined || change.pinned !== undefined) schedule();
});
chrome.tabs.onRemoved.addListener(tabId => {
  engine.forgetTab(tabId).catch(report);
  schedule();
});
chrome.tabs.onAttached.addListener(schedule);
chrome.tabs.onDetached.addListener(schedule);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message.type === "pageMetadata" && sender.tab?.id && /^https?:\/\//.test(sender.url || "")) {
    engine.pageMetadata(sender.tab.id, sender.url, sender.tab.windowId, message).catch(report);
    return false;
  }
  if (!["popup.html", "options.html"].some(page => sender.url === chrome.runtime.getURL(page))) return false;
  const handle = async () => {
    switch (message.type) {
      case "status": return engine.status(message.windowId);
      case "organize": return engine.organize({ windowId: message.windowId, force: true });
      case "settings": return engine.save(message.settings);
      case "remember": return engine.remember(message.domain, message.category);
      case "release": return engine.release();
      case "toggleGroup": return engine.toggleGroup(message.groupId, message.windowId);
      default: throw new Error("Unknown request");
    }
  };
  handle().then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});
// Recreate the backup alarm whenever a fresh worker starts.
initialize().catch(report);
