import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const FILE = process.env.DATA_DIR
  ? join(process.env.DATA_DIR, "tracker.json")
  : fileURLToPath(new URL("./tracker.json", import.meta.url));
const MAX_PER_CHAT = 20;

export const EVENT_KEYS = [
  "online",
  "level",
  "guild",
  "title",
  "pvp",
  "rank_exp",
  "rank_melee",
  "rank_distance",
  "rank_magic",
  "rank_defense",
];

export const DEFAULT_EVENTS = {
  online: true,
  level: true,
  guild: true,
  title: true,
  pvp: true,
  // Rank tracking is opt-in: each enabled category costs one extra request per tick.
  rank_exp: false,
  rank_melee: false,
  rank_distance: false,
  rank_magic: false,
  rank_defense: false,
};

function newId() {
  return randomBytes(4).toString("hex");
}

export class TrackerStore {
  constructor(data) {
    this.data = data;
    this.saving = Promise.resolve();
  }

  static async load() {
    try {
      const raw = await readFile(FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.subs !== "object") throw new Error("bad shape");
      for (const sub of Object.values(parsed.subs)) {
        sub.events = { ...DEFAULT_EVENTS, ...(sub.events ?? {}) };
      }
      return new TrackerStore(parsed);
    } catch {
      return new TrackerStore({ subs: {} });
    }
  }

  save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.saving = this.saving
      .then(() => mkdir(dirname(FILE), { recursive: true }))
      .then(() => writeFile(`${FILE}.tmp`, snapshot, "utf8"))
      .then(() => rename(`${FILE}.tmp`, FILE))
      .catch((err) => console.error("tracker save failed:", err));
    return this.saving;
  }

  all() {
    return Object.values(this.data.subs);
  }

  get(id) {
    return this.data.subs[id] ?? null;
  }

  byChat(chatId) {
    return this.all().filter((s) => s.chatId === chatId);
  }

  findByName(chatId, name) {
    const wanted = name.toLowerCase();
    return this.byChat(chatId).find((s) => s.name.toLowerCase() === wanted) ?? null;
  }

  add(chatId, userId, name, snapshot) {
    const existing = this.findByName(chatId, name);
    if (existing) {
      existing.snapshot = snapshot;
      existing.updatedAt = Date.now();
      return { sub: existing, created: false };
    }
    if (this.byChat(chatId).length >= MAX_PER_CHAT) {
      return { sub: null, created: false, error: `limit:${MAX_PER_CHAT}` };
    }
    const sub = {
      id: newId(),
      chatId,
      userId,
      name,
      events: { ...DEFAULT_EVENTS },
      snapshot,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.subs[sub.id] = sub;
    return { sub, created: true };
  }

  remove(id) {
    if (!this.data.subs[id]) return false;
    delete this.data.subs[id];
    return true;
  }
}