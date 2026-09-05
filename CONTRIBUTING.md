# Contributing to Tabnest

Thanks for helping make browser tabs calmer.

## Development

Tabnest is a dependency-free Manifest V3 Chrome extension. There is no build step.

1. Fork and clone the repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository folder.
5. After changing source files, click **Reload** on the Tabnest extension card.

Run the logic tests with Node.js 20 or newer:

```sh
node --test tests/*.test.js
```

The optional browser test requires Playwright and Chrome for Testing. Its environment variables and behavior are documented in the main README.

## Pull requests

- Keep classification deterministic, local, and explainable.
- Add focused tests for classifier, ownership, or tab-lifecycle changes.
- Do not add remote code, analytics, trackers, or network requests.
- Document any new Chrome permission and why it is needed.
- Preserve existing user-created tab groups unless a change explicitly concerns them.

For a new built-in category or domain, explain the intended category and include a test demonstrating the mapping.

## Issues

When reporting a classification problem, include the website domain, the category you expected, the category Tabnest selected, and whether you had saved a website correction. Avoid sharing private URLs or query strings.
