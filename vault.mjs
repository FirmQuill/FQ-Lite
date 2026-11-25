// The storage adapter sees only the encrypted envelope and an opaque revision token.
const FORMAT = "erp-lite-vault";
const VERSION = 1;
const ROUNDS = 600_000;
const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_BACKUP_BYTES = Math.ceil((MAX_BYTES + 16) / 3) * 4 + 1024;
export const VAULT_DB = "erp-lite:v1:" + new URL(".", import.meta.url).pathname;
const encode = new TextEncoder();
const decode = new TextDecoder("utf-8", { fatal: true });

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  }
  return btoa(binary);
}

function unbase64(value, length) {
  if (typeof value !== "string" || value.length !== Math.ceil(length / 3) * 4) {
    throw Error("Invalid vault header.");
  }
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (bytes.length !== length || base64(bytes) !== value) throw Error("Invalid vault header.");
  return bytes;
}

function random64(size) {
  return base64(crypto.getRandomValues(new Uint8Array(size)));
}

function checkEnvelope(e) {
  const fields = ["format", "version", "iterations", "salt", "token", "iv", "ciphertext"];
  if (!e || e.format !== FORMAT || e.version !== VERSION || e.iterations !== ROUNDS ||
      Object.keys(e).length !== fields.length || fields.some(k => !Object.hasOwn(e, k))) {
    throw Error("Unsupported or damaged vault format.");
  }
  unbase64(e.salt, 16);
  unbase64(e.token, 16);
  unbase64(e.iv, 12);
  if (typeof e.ciphertext !== "string" || e.ciphertext.length < 24 ||
      e.ciphertext.length > Math.ceil((MAX_BYTES + 16) / 3) * 4) throw Error("Invalid vault size.");
}

function parameters(e) {
  const additionalData = encode.encode(JSON.stringify([e.format, e.version, e.iterations, e.salt, e.token]));
  return { name: "AES-GCM", iv: unbase64(e.iv, 12), tagLength: 128, additionalData };
}

async function derive(password, salt) {
  if (typeof password !== "string" || !password.length) throw Error("Enter the vault password.");
  const bytes = encode.encode(password);
  try {
    const material = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: unbase64(salt, 16), iterations: ROUNDS },
      material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  } finally { bytes.fill(0); }
}

async function validate(payload, validator) {
  if (typeof validator !== "function") throw Error("A record format validator is required.");
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      await validator(payload) === false) throw Error("The vault has an invalid record format.");
}

async function encryptState(state, key, salt, validator) {
  const json = JSON.stringify(state);
  if (typeof json !== "string" || json.length > MAX_BYTES) throw Error("Invalid vault payload size.");
  const payload = JSON.parse(json);
  await validate(payload, validator);
  const bytes = encode.encode(json);
  try {
    if (bytes.length > MAX_BYTES) throw Error("Vault exceeds the 32 MiB snapshot limit.");
    const envelope = { format: FORMAT, version: VERSION, iterations: ROUNDS, salt, token: random64(16), iv: random64(12) };
    const encrypted = await crypto.subtle.encrypt(parameters(envelope), key, bytes);
    envelope.ciphertext = base64(new Uint8Array(encrypted));
    return { envelope, payload };
  } finally { bytes.fill(0); }
}

async function decryptState(envelope, password, validator) {
  checkEnvelope(envelope);
  const key = await derive(password, envelope.salt);
  let plain;
  try {
    const bytes = Uint8Array.from(atob(envelope.ciphertext), c => c.charCodeAt(0));
    if (base64(bytes) !== envelope.ciphertext) throw Error();
    plain = new Uint8Array(await crypto.subtle.decrypt(parameters(envelope), key, bytes));
  } catch { throw Error("Unable to unlock. Check the password and the integrity of the backup."); }
  try {
    const payload = JSON.parse(decode.decode(plain));
    await validate(payload, validator);
    return { payload, key };
  } finally { plain.fill(0); }
}

async function database() {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
    throw Error("Open the app using HTTPS or localhost in a browser with IndexedDB and Web Crypto.");
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VAULT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sealed");
    request.onerror = () => reject(Error("The browser could not open encrypted vault storage."));
    request.onsuccess = () => resolve(request.result);
  });
}

function stale() { return Error("The vault changed in another session. Lock and unlock to load the saved revision."); }

const browserStore = {
  async read() {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("sealed", "readonly");
        const request = tx.objectStore("sealed").get("current");
        tx.oncomplete = () => resolve(request.result ?? null);
        tx.onabort = () => reject(Error("The encrypted vault could not be read."));
      });
    } finally { db.close(); }
  },
  async replace(token, envelope) {
    const db = await database();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("sealed", "readwrite");
        const store = tx.objectStore("sealed");
        const current = store.get("current");
        let conflict = false;
        current.onsuccess = () => {
          if ((current.result?.token ?? null) !== token || (token === null && current.result !== undefined)) {
            conflict = true;
            tx.abort();
          } else {
            store.put(envelope, "current");
          }
        };
        tx.oncomplete = resolve;
        tx.onabort = () => reject(conflict ? stale() : Error("Save failed. Check browser storage space and try again."));
      });
    } finally { db.close(); }
  }
};

// The adapter must atomically replace only the expected token. A null token means empty storage.
export function createVaultService(store) {
  const sessions = new WeakMap();
  function sessionFor(payload, key, envelope, validator) {
    const held = { payload, key, envelope, busy: false };
    const session = {
      get state() {
        if (!held.key) throw Error("Vault is locked.");
        return structuredClone(held.payload);
      },
      async save(nextState) {
        if (!held.key) throw Error("Vault is locked.");
        if (held.busy) throw Error("A vault change is already in progress.");
        held.busy = true;
        try {
          const next = await encryptState(nextState, held.key, held.envelope.salt, validator);
          if (!held.key) throw Error("Vault is locked.");
          await store.replace(held.envelope.token, next.envelope);
          if (held.key) {
            held.payload = next.payload;
            held.envelope = next.envelope;
          }
        } finally { held.busy = false; }
      },
      backup() {
        if (!held.key || held.busy) throw Error("Unlock the vault and finish the current save before backing up.");
        return JSON.stringify(held.envelope);
      },
      lock() { held.key = held.payload = held.envelope = null; }
    };
    sessions.set(session, held);
    return Object.freeze(session);
  }
  return {
    async hasVault() { return (await store.read()) !== null; },
    async createVault(password, initialState, validator) {
      if (typeof password !== "string" || [...password].length < 12) throw Error("Use at least 12 characters for the vault password.");
      if (await store.read() !== null) throw Error("This browser already has a vault.");
      const salt = random64(16);
      const key = await derive(password, salt);
      const { payload, envelope } = await encryptState(initialState, key, salt, validator);
      await store.replace(null, envelope);
      return sessionFor(payload, key, envelope, validator);
    },
    async openVault(password, validator) {
      const envelope = await store.read();
      if (!envelope) throw Error("This browser has no saved vault.");
      const { payload, key } = await decryptState(envelope, password, validator);
      return sessionFor(payload, key, envelope, validator);
    },
    async restoreVault(json, password, validator, currentSession) {
      const held = sessions.get(currentSession);
      if (currentSession !== undefined && (!held?.key || held.busy)) throw Error("Unlock the destination vault and finish any save.");
      const token = held?.envelope.token ?? null;
      if ((await store.read())?.token !== (token ?? undefined)) {
        if (!held) throw Error("Unlock the existing vault before replacing it.");
        throw stale();
      }
      if (typeof json !== "string" || json.length > MAX_BACKUP_BYTES) throw Error("Invalid or oversized backup.");
      if (held && (!held.key || held.busy || held.envelope.token !== token)) throw stale();
      if (held) held.busy = true;
      try {
        const source = JSON.parse(json);
        const { payload, key: sourceKey } = await decryptState(source, password, validator);
        // A new authenticated token also invalidates old tabs when restoring the same revision.
        const key = held?.key ?? sourceKey;
        const salt = held?.envelope?.salt ?? source.salt;
        const next = await encryptState(payload, key, salt, validator);
        if (held && !held.key) throw Error("Vault is locked.");
        await store.replace(token, next.envelope);
        currentSession?.lock();
        return sessionFor(next.payload, key, next.envelope, validator);
      } finally { if (held) held.busy = false; }
    }
  };
}

export const { hasVault, createVault, openVault, restoreVault } = createVaultService(browserStore);
