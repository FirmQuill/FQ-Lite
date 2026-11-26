import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createVaultService, MAX_BACKUP_BYTES, VAULT_DB } from "../vault.mjs";

const password = "A synthetic study password 9174";
const alternate = "Second synthetic test secret";
const records = { version: 1, companies: [{ id: "fake-company", name: "Synthetic Test Works", amount: "30001" }] };
const changed = { ...records, companies: [{ ...records.companies[0], amount: "1043" }] };
function validate(s) {
  return s.version === 1 && Array.isArray(s.companies) && s.companies.every(c => typeof c.amount === "string");
}
function memoryStore() {
  let stored = null;
  return {
    async read() { return structuredClone(stored); },
    async replace(expected, next) {
      if ((stored?.token ?? null) !== expected) throw Error("Conflict with newer revision");
      stored = structuredClone(next);
    }
  };
}

test("create, save, lock, reopen; only ciphertext reaches durable storage", async () => {
  const store = memoryStore();
  const svc = createVaultService(store);
  assert.match(VAULT_DB, /^erp-lite:v1:/);
  assert.equal(await svc.hasVault(), false);
  await assert.rejects(svc.createVault("short", records, validate), /12 characters/);
  const a = await svc.createVault(password, records, validate);
  assert.equal(await svc.hasVault(), true);
  assert.deepEqual(a.state, records);
  await assert.rejects(svc.createVault(password, changed, validate), /already/);
  const before = await store.read();
  assert.deepEqual(JSON.parse(a.backup()), before);
  for (const field of ["Synthetic Test Works", "fake-company", "companies", password]) {
    assert.equal(a.backup().includes(field), false);
  }
  const detached = a.state;
  detached.companies[0].amount = "50";
  assert.deepEqual(a.state, records);
  await a.save(changed);
  const after = await store.read();
  assert.notEqual(before.iv, after.iv);
  assert.notEqual(before.token, after.token);
  assert.notEqual(before.ciphertext, after.ciphertext);
  a.lock();
  assert.throws(() => a.state, /locked/);
  assert.throws(() => a.backup(), /Unlock/);
  await assert.rejects(a.save(records), /locked/);
  await assert.rejects(svc.openVault(alternate, validate), /Unable to unlock/);
  assert.deepEqual((await svc.openVault(password, validate)).state, changed);
});

test("restore authenticates ciphertext and header and validates schema before writing", async () => {
  const svc = createVaultService(memoryStore());
  const a = await svc.createVault(password, records, validate);
  const backup = a.backup();
  const store = memoryStore();
  const destination = createVaultService(store);
  await assert.rejects(destination.restoreVault(backup, alternate, validate), /Unable to unlock/);
  for (const field of ["ciphertext", "iv", "token", "salt"]) {
    const envelope = JSON.parse(backup);
    envelope[field] = (envelope[field][0] === "A" ? "B" : "A") + envelope[field].slice(1);
    await assert.rejects(destination.restoreVault(JSON.stringify(envelope), password, validate));
  }
  for (const patch of [{ version: 2 }, { iterations: 1 }, { extra: "unexpected" }]) {
    await assert.rejects(destination.restoreVault(JSON.stringify({ ...JSON.parse(backup), ...patch }), password, validate));
  }
  await assert.rejects(destination.restoreVault(backup, password, () => false), /record format/);
  await assert.rejects(destination.restoreVault(" ".repeat(MAX_BACKUP_BYTES + 1), password, validate), /oversized/);
  assert.equal(await store.read(), null);
  const restored = await destination.restoreVault(backup, password, validate);
  assert.deepEqual(restored.state, records);
  assert.notEqual(restored.backup(), backup);
  restored.lock();
  assert.deepEqual((await destination.openVault(password, validate)).state, records);
});

test("replacing an occupied vault requires its own current session and preserves its password", async () => {
  const source = createVaultService(memoryStore());
  const backup = (await source.createVault(password, records, validate)).backup();
  const svc = createVaultService(memoryStore());
  const owner = await svc.createVault(alternate, changed, validate);
  const oldTab = await svc.openVault(alternate, validate);
  await assert.rejects(svc.restoreVault(backup, password, validate), /Unlock the existing/);
  await assert.rejects(svc.restoreVault(backup, password, validate, {}), /Unlock the destination/);
  await assert.rejects(svc.restoreVault(backup, "incorrect", validate, owner), /Unable to unlock/);
  assert.deepEqual(owner.state, changed);
  const restored = await svc.restoreVault(backup, password, validate, owner);
  assert.throws(() => owner.state, /locked/);
  assert.deepEqual(restored.state, records);
  await assert.rejects(svc.openVault(password, validate));
  assert.deepEqual((await svc.openVault(alternate, validate)).state, records);
  await assert.rejects(oldTab.save(changed), /Conflict/);
  await assert.rejects(svc.restoreVault(backup, password, validate, oldTab), /another session/);
});

test("simultaneous sessions preserve the winning commit and invalid writes do not change revision", async () => {
  const store = memoryStore();
  const svc = createVaultService(store);
  const a = await svc.createVault(password, records, validate);
  const b = await svc.openVault(password, validate);
  const result = await Promise.allSettled([a.save(records), b.save(changed)]);
  assert.equal(result.filter(r => r.status === "fulfilled").length, 1);
  const winner = result[0].status === "fulfilled" ? a : b;
  const before = await store.read();
  await assert.rejects(winner.save({ version: 2 }), /invalid record format/);
  assert.deepEqual(await store.read(), before);
  assert.deepEqual((await svc.openVault(password, validate)).state, winner.state);
});

test("failed persistence leaves last saved revision available for retry", async () => {
  const store = memoryStore();
  const svc = createVaultService(store);
  const a = await svc.createVault(password, records, validate);
  const original = a.backup();
  const replace = store.replace;
  store.replace = async () => { throw Error("synthetic storage failure"); };
  await assert.rejects(a.save(changed), /storage failure/);
  assert.deepEqual(a.state, records);
  assert.equal(a.backup(), original);
  store.replace = replace;
  await a.save(changed);
  assert.deepEqual(a.state, changed);
});

// Set ERP_LITE_BROWSER_EXE to run this additional check against the browser's actual IndexedDB.
if (process.env.ERP_LITE_BROWSER_EXE) test("real browser IndexedDB, project scope, two tabs and encrypted recovery", async () => {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.ERP_LITE_PLAYWRIGHT || "playwright");
  const module = await readFile(new URL("../vault.mjs", import.meta.url));
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url.endsWith("/vault.mjs")) {
      res.setHeader("Content-Type", "text/javascript");
      res.end(module);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Synthetic vault test</title>");
    }
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.ERP_LITE_BROWSER_EXE, headless: true });
    const context = await browser.newContext();
    const url = "http://127.0.0.1:" + server.address().port;
    async function tabAt(scope) {
      const page = await context.newPage();
      await page.goto(url + "/" + scope + "/");
      await page.evaluate(async () => {
        window.api = await import("./vault.mjs");
        window.check = s => s.version === 1;
      });
      return page;
    }
    const a = await tabAt("alpha");
    const b = await tabAt("alpha");
    const clean = await tabAt("beta");
    await a.evaluate(async ([password, state]) => {
      window.session = await window.api.createVault(password, state, window.check);
    }, [password, records]);
    await b.evaluate(async password => { window.session = await window.api.openVault(password, window.check); }, password);
    await a.evaluate(s => window.session.save(s), changed);
    await assert.rejects(b.evaluate(s => window.session.save(s), records), /another session/);
    const backup = await a.evaluate(() => window.session.backup());
    const disk = await a.evaluate(async () => {
      const db = await new Promise(resolve => {
        const r = indexedDB.open(window.api.VAULT_DB);
        r.onsuccess = () => resolve(r.result);
      });
      const request = db.transaction("sealed").objectStore("sealed").getAll();
      return new Promise(resolve => { request.onsuccess = () => { db.close(); resolve(request.result); }; });
    });
    assert.deepEqual(disk, [JSON.parse(backup)]);
    assert.ok(!backup.includes(records.companies[0].name));
    assert.equal(await clean.evaluate(() => window.api.hasVault()), false);
    await assert.rejects(clean.evaluate(([json, pw]) => window.api.restoreVault(json, pw, window.check), [backup, alternate]), /Unable to unlock/);
    assert.equal(await clean.evaluate(() => window.api.hasVault()), false);
    assert.deepEqual(await clean.evaluate(async ([json, pw]) => {
      const restored = await window.api.restoreVault(json, pw, window.check);
      restored.lock();
      return (await window.api.openVault(pw, window.check)).state;
    }, [backup, password]), changed);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
