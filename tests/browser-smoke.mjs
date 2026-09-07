// Optional integration test: uses a local Playwright installation and an isolated Chromium profile.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "tabnest-browser-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: "chromium" }),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
try {
  await context.route(/^https?:/, route => {
    const host = new URL(route.request().url()).hostname;
    const description = host === "described.test" ? '<meta name="description" content="An AI assistant for creative research">' : "";
    return route.fulfill({ contentType: "text/html", body: `<!doctype html>${description}<title>${host}</title><h1>Local test fixture</h1>` });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const errors = [];
  worker.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  const id = new URL(worker.url()).host;
  const work1 = await context.newPage(); await work1.goto("https://docs.google.com/document/test");
  const work2 = await context.newPage(); await work2.goto("https://notion.so/test");
  const code1 = await context.newPage(); await code1.goto("https://github.com/test");
  const code2 = await context.newPage(); await code2.goto("https://gitlab.com/test");
  const pinned = await context.newPage(); await pinned.goto("https://github.com/pinned");
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://github.com/pinned" });
    await chrome.tabs.update(tab.id, { pinned: true });
  });
  // Exercise the actual background event debounce, without explicitly organizing.
  let state;
  for (let attempt = 0; attempt < 20; attempt++) {
    state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}) }));
    if (state.tabs.find(tab => tab.url === "https://github.com/pinned")?.groupId === -1 && state.groups.some(group => group.title === "💻 Developer")) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(state.groups.some(group => group.title === "🗂️ Work"));
  assert.ok(state.groups.some(group => group.title === "💻 Developer"));
  const pinnedState = state.tabs.find(tab => tab.url === "https://github.com/pinned");
  assert.equal(pinnedState.pinned, true);
  assert.equal(pinnedState.groupId, -1);
  console.log("PASS: real extension automatically groups tabs and skips pinned tabs");
  const duplicate = await context.newPage();
  await duplicate.goto("https://github.com/test").catch(() => {});
  for (let attempt = 0; attempt < 20; attempt++) {
    state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}) }));
    if (state.tabs.filter(tab => tab.url === "https://github.com/test").length === 1) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(state.tabs.filter(tab => tab.url === "https://github.com/test").length, 1);
  assert.equal((await worker.evaluate(() => chrome.storage.session.get("duplicateCount"))).duplicateCount, 1);
  const distinct = await context.newPage(); await distinct.goto("https://github.com/test?view=1");
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal((await worker.evaluate(() => chrome.tabs.query({ url: "https://github.com/test?view=1" }))).length, 1);
  console.log("PASS: exact URLs reuse the older tab while distinct query strings remain open");
  // Simulate the ownership record disappearing during an unpacked-extension reload.
  await worker.evaluate(() => chrome.storage.session.set({ owned: [] }));
  const posthog = await context.newPage(); await posthog.goto("https://app.posthog.com/project/1");
  await new Promise(resolve => setTimeout(resolve, 2200));
  state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}) }));
  const developerGroups = state.groups.filter(group => group.title === "💻 Developer");
  assert.equal(developerGroups.length, 1);
  assert.equal(state.tabs.filter(tab => tab.groupId === developerGroups[0].id).length, 4);
  console.log("PASS: lost ownership is reconstructed without creating duplicate Developer groups");
  const manuallyPlaced = await context.newPage();
  await manuallyPlaced.goto("https://youtube.com/manual-placement");
  await new Promise(resolve => setTimeout(resolve, 2200));
  const manualPlacement = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://youtube.com/manual-placement" });
    const [developer] = await chrome.tabGroups.query({ title: "💻 Developer" });
    await chrome.tabs.group({ groupId: developer.id, tabIds: [tab.id] });
    return { tabId: tab.id, groupId: developer.id };
  });
  await new Promise(resolve => setTimeout(resolve, 2200));
  state = await worker.evaluate(async () => ({
    tabs: await chrome.tabs.query({}),
    manualTabs: (await chrome.storage.session.get("manualTabs")).manualTabs || {}
  }));
  assert.equal(state.tabs.find(tab => tab.id === manualPlacement.tabId).groupId, manualPlacement.groupId);
  assert.equal(state.manualTabs[manualPlacement.tabId], manualPlacement.groupId);
  await manuallyPlaced.goto("https://docs.google.com/document/manual-placement");
  await new Promise(resolve => setTimeout(resolve, 2200));
  state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}) }));
  assert.equal(state.tabs.find(tab => tab.id === manualPlacement.tabId).groupId, manualPlacement.groupId);
  await manuallyPlaced.close();
  await new Promise(resolve => setTimeout(resolve, 250));
  const manualTabsAfterClose = await worker.evaluate(async () => (await chrome.storage.session.get("manualTabs")).manualTabs || {});
  assert.equal(manualTabsAfterClose[manualPlacement.tabId], undefined);
  const learnedPlacement = await context.newPage();
  await learnedPlacement.goto("https://youtube.com/learned-placement");
  await new Promise(resolve => setTimeout(resolve, 2200));
  state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}) }));
  assert.equal(state.tabs.find(tab => tab.url === "https://youtube.com/learned-placement").groupId, manualPlacement.groupId);
  await learnedPlacement.close();
  console.log("PASS: manually placed tabs stay put, clean up on close, and teach future website tabs");
  const popup = await context.newPage();
  popup.on("pageerror", error => errors.push(error.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator("#organize").waitFor({ state: "visible" });
  await popup.waitForFunction(() => !document.querySelector("#organize").disabled);
  assert.equal(await popup.locator("#state").textContent(), "Auto on");
  assert.equal(await popup.locator(".group").count(), 2);
  await popup.setViewportSize({ width: 392, height: 650 });
  await popup.screenshot({ path: path.join(extension, "..", "tabnest-preview.png"), fullPage: true });
  await popup.locator("#preferences summary").click();
  await popup.locator("#excluded").fill("github.com");
  await popup.locator("#save").click();
  await popup.waitForFunction(() => document.querySelector("#message").textContent === "Preferences saved and applied.");
  state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}) }));
  assert.equal(state.tabs.find(tab => tab.url === "https://github.com/test").groupId, -1);
  console.log("PASS: popup settings ungroup excluded websites");
  await popup.locator("#enabled").uncheck();
  await popup.waitForFunction(() => document.querySelector("#state").textContent === "Paused");
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://gitlab.com/test" });
    await chrome.tabGroups.update(tab.groupId, { title: "My project" });
  });
  await popup.locator("#release").click();
  await popup.waitForFunction(() => document.querySelector("#message").textContent.includes("Automatic placements released"));
  state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}) }));
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].title, "My project");
  assert.equal(state.tabs.find(tab => tab.url === "https://docs.google.com/document/test").groupId, -1);
  console.log("PASS: pause and release preserve manually renamed groups");
  // Regression: a real window with six different websites used to produce no groups.
  for (const page of [work1, work2, code1, code2, pinned, posthog, distinct]) await page.close();
  for (let index = 0; index < 6; index++) {
    const page = await context.newPage();
    await page.goto(`https://site${index}.test/`);
  }
  await popup.bringToFront();
  await popup.locator("#organize").click();
  await popup.waitForFunction(() => document.querySelector("#message").textContent.includes("related tabs are organized"));
  state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}) }));
  const browsing = state.groups.find(group => group.title === "🧭 Browsing");
  assert.ok(browsing);
  assert.equal(state.tabs.filter(tab => tab.groupId === browsing.id).length, 6);
  assert.equal(await popup.locator("#grouped").textContent(), "6");
  console.log("PASS: Organize groups six different websites into Browsing");
  await popup.locator("#enabled").check();
  await popup.waitForFunction(() => document.querySelector("#state").textContent === "Auto on");
  const original = context.pages().find(page => page.url() === "https://site0.test/");
  await original.evaluate(() => { document.title = "API documentation"; });
  const matching = await context.newPage(); await matching.goto("https://site0.test/another");
  await matching.evaluate(() => { document.title = "API documentation"; });
  await new Promise(resolve => setTimeout(resolve, 2200));
  state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}) }));
  const specific = state.groups.find(group => group.title === "💻 Developer");
  assert.ok(specific);
  assert.equal(state.tabs.filter(tab => tab.groupId === specific.id).length, 2);
  assert.equal(state.tabs.filter(tab => tab.groupId === browsing.id).length, 5);
  console.log("PASS: unfamiliar sites move from Browsing into Developer based on title context");
  const options = await context.newPage();
  options.on("pageerror", error => errors.push(error.message));
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(() => !document.querySelector("#save").disabled);
  assert.equal(await options.locator(".category").count(), 22);
  await options.locator("#add").click();
  const custom = options.locator(".category").last();
  await custom.locator(".name").fill("My Craft");
  await custom.locator(".emoji").fill("🧶");
  await custom.locator(".color").selectOption("orange");
  await custom.locator(".domains").fill("craft.test");
  await custom.locator(".keywords").fill("handmade ceramics");
  await options.locator("#save").click();
  await options.waitForFunction(() => document.querySelector("#status").textContent.includes("23 categories saved"));
  const craft = await context.newPage(); await craft.goto("https://craft.test/shop");
  await new Promise(resolve => setTimeout(resolve, 2200));
  state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}) }));
  const craftGroup = state.groups.find(group => group.title === "🧶 My Craft");
  assert.ok(craftGroup);
  assert.equal(state.tabs.find(tab => tab.url === "https://craft.test/shop").groupId, craftGroup.id);
  console.log("PASS: custom categories are saved and used by automatic grouping");
  const described = await context.newPage(); await described.goto("https://described.test/product");
  await new Promise(resolve => setTimeout(resolve, 2200));
  state = await worker.evaluate(async () => ({ tabs: await chrome.tabs.query({}), groups: await chrome.tabGroups.query({}) }));
  const aiGroup = state.groups.find(group => group.title === "🤖 AI Apps");
  assert.ok(aiGroup);
  assert.equal(state.tabs.find(tab => tab.url === "https://described.test/product").groupId, aiGroup.id);
  console.log("PASS: a meta description classifies a tab with an unclear title");
  assert.deepEqual(errors, []);
  console.log("PASS: no extension page errors; popup screenshot saved");
} finally { await context.close(); }
