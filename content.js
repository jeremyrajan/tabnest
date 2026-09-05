// Page metadata is untrusted input. Send only short, inert strings to the local classifier.
let lastPayload = "";
let timer;

function metadataContent(selectors) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.content?.trim();
    if (value) return value;
  }
  return "";
}

function publishMetadata() {
  const description = metadataContent([
    'meta[name="description" i]',
    'meta[property="og:description" i]',
    'meta[name="twitter:description" i]'
  ]).slice(0, 600);
  const siteName = metadataContent([
    'meta[property="og:site_name" i]',
    'meta[name="application-name" i]'
  ]).slice(0, 100);
  const payload = JSON.stringify({ description, siteName });
  if (payload === lastPayload) return;
  lastPayload = payload;
  chrome.runtime.sendMessage({ type: "pageMetadata", description, siteName }).catch(() => {});
}

function schedulePublish() {
  clearTimeout(timer);
  timer = setTimeout(publishMetadata, 400);
}

publishMetadata();
if (document.head) {
  new MutationObserver(schedulePublish).observe(document.head, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["content"]
  });
}
