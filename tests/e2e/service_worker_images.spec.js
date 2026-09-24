const { test, expect } = require('@playwright/test');
const visuals = require('../../js/exercise_visuals.js');

test('service worker activates without original exercise images and caches them on demand for offline use', async ({ page }) => {
  await page.goto('/#/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const images = visuals.approved.map(({ src, bytes }) => ({ path: src, bytes }));
  const initial = await page.evaluate(async () => {
    const shell = await caches.open('vision-coach-v154');
    const images = await caches.open('vision-coach-approved-exercises-v1');
    return {
      teamCrestCached: !!(await shell.match(new URL('./assets/teams/14529_imgbank.png', location.href))),
      playerArchiveCached: !!(await shell.match(new URL('./js/player_archive.js', location.href))),
      shellImages: (await shell.keys()).filter(request => request.url.includes('/approved-20260922/')).length,
      cachedImages: (await images.keys()).length,
    };
  });
  expect(initial).toEqual({ teamCrestCached: true, playerArchiveCached: true, shellImages: 0, cachedImages: 0 });

  const archiveScriptOnline = await page.evaluate(async () => {
    const response = await fetch('./js/player_archive.js');
    return { status: response.status, includesArchiveApi: (await response.text()).includes('PlayerArchive') };
  });
  expect(archiveScriptOnline).toEqual({ status: 200, includesArchiveApi: true });

  const online = await page.evaluate(async expected => Promise.all(expected.map(async image => {
    const response = await fetch(image.path);
    return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  })), images);
  expect(online).toEqual(images.map(image => ({ status: 200, bytes: image.bytes })));

  await page.context().setOffline(true);
  const offline = await page.evaluate(async expected => Promise.all(expected.map(async image => {
    const response = await fetch(image.path);
    return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  })), images);
  expect(offline).toEqual(online);

  const archiveScriptOffline = await page.evaluate(async () => {
    const response = await fetch('./js/player_archive.js');
    return { status: response.status, includesArchiveApi: (await response.text()).includes('PlayerArchive') };
  });
  expect(archiveScriptOffline).toEqual(archiveScriptOnline);
});
