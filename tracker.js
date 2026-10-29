import { fetchSnapshot, fetchCategoryTop, RANK_CATEGORIES } from "./data.js";
import { escapeHtml } from "./format.js";

const RANK_LABELS = {
  rank_exp: "Experience",
  rank_melee: "Melee",
  rank_distance: "Distance",
  rank_magic: "Magic",
  rank_defense: "Defense",
};

const INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.TRACK_INTERVAL_MS ?? 2 * 60 * 1000),
);

function multisetAdded(prev, next) {
  const counts = new Map();
  for (const item of prev) counts.set(item, (counts.get(item) ?? 0) + 1);
  const added = [];
  for (const item of next) {
    const left = counts.get(item) ?? 0;
    if (left > 0) counts.set(item, left - 1);
    else added.push(item);
  }
  return added;
}

export function buildNotifications(sub, snap) {
  const prev = sub.snapshot;
  if (!prev) return [];
  const name = `<b>${escapeHtml(snap.name)}</b>`;
  const ev = sub.events;
  const out = [];

  if (ev.online && prev.online !== snap.online) {
    if (snap.online) {
      out.push(`🟢 ${name} зашёл в игру`);
    } else {
      const when = snap.lastOnline ? ` (${escapeHtml(snap.lastOnline)})` : "";
      out.push(`🔴 ${name} вышел из игры${when}`);
    }
  }

  if (ev.level && prev.level !== snap.level) {
    out.push(
      `📈 ${name}: уровень ${escapeHtml(prev.level ?? "—")} → <b>${escapeHtml(snap.level ?? "—")}</b>`,
    );
  }

  if (ev.guild && (prev.guild ?? null) !== (snap.guild ?? null)) {
    out.push(
      `🛡 ${name}: гильдия ${escapeHtml(prev.guild ?? "без гильдии")} → <b>${escapeHtml(snap.guild ?? "без гильдии")}</b>`,
    );
  }

  if (ev.title && (prev.title ?? null) !== (snap.title ?? null)) {
    out.push(
      `🎖 ${name}: титул ${escapeHtml(prev.title ?? "—")} → <b>${escapeHtml(snap.title ?? "—")}</b>`,
    );
  }

  if (ev.pvp) {
    const added = multisetAdded(prev.activity ?? [], snap.activity ?? []);
    if (added.length) {
      out.push(
        `⚔️ ${name}: новые события\n${added.map((e) => `• ${escapeHtml(e)}`).join("\n")}`,
      );
    }
  }

  if (prev.ranks) {
    for (const [key, category] of Object.entries(RANK_CATEGORIES)) {
      if (!ev[key]) continue;
      const before = prev.ranks[key];
      const after = snap.ranks?.[key];
      if (before === undefined || after === undefined) continue;

      const label = RANK_LABELS[key] ?? category;
      if (!before && after) {
        out.push(
          `🏆 ${name} вошёл в топ-100 ${label}: <b>#${after.rank}</b> (${escapeHtml(after.value)})`,
        );
      } else if (before && !after) {
        out.push(`🏆 ${name} выпал из топ-100 ${label} (был #${before.rank})`);
      } else if (before && after && before.rank !== after.rank) {
        out.push(
          `🏆 ${name}: ${label} #${before.rank} → <b>#${after.rank}</b> (${escapeHtml(after.value)})`,
        );
      }
    }
  }

  return out;
}

export async function pollOnce(bot, store) {
  const subs = store.all();
  if (!subs.length) return;

  const names = [...new Set(subs.map((s) => s.name))];
  const snapshots = new Map();

  for (const name of names) {
    try {
      snapshots.set(name, await fetchSnapshot(name));
    } catch (err) {
      console.error(`tracker: fetch ${name} failed:`, err.message);
      snapshots.set(name, undefined);
    }
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
  }

  // One leaderboard request per category per tick, shared by every subscriber.
  const enabledCategories = new Set();
  for (const sub of subs) {
    for (const [key, category] of Object.entries(RANK_CATEGORIES)) {
      if (sub.events[key]) enabledCategories.add(category);
    }
  }

  const topMaps = new Map();
  for (const category of enabledCategories) {
    try {
      const list = await fetchCategoryTop(category);
      const map = new Map();
      for (const item of list) {
        map.set(item.name.toLowerCase(), { rank: item.rank, value: item.value });
      }
      topMaps.set(category, map);
    } catch (err) {
      console.error(`tracker: top ${category} failed:`, err.message);
      topMaps.set(category, null);
    }
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
  }

  let changed = false;
  for (const sub of subs) {
    const snap = snapshots.get(sub.name);
    if (snap === undefined || snap === null) continue;

    const ranks = {};
    for (const [key, category] of Object.entries(RANK_CATEGORIES)) {
      if (!sub.events[key]) continue;
      const map = topMaps.get(category);
      if (!map) {
        // The leaderboard failed to load: keep the previous value, don't guess.
        if (sub.snapshot?.ranks && key in sub.snapshot.ranks) {
          ranks[key] = sub.snapshot.ranks[key];
        }
        continue;
      }
      ranks[key] = map.get(sub.name.toLowerCase()) ?? null;
    }
    snap.ranks = ranks;

    const messages = buildNotifications(sub, snap);
    if (messages.length) {
      try {
        await bot.api.sendMessage(sub.chatId, messages.join("\n\n"), {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      } catch (err) {
        console.error(`tracker: notify ${sub.chatId} failed:`, err.message);
      }
    }

    sub.snapshot = snap;
    sub.updatedAt = Date.now();
    changed = true;
  }

  if (changed) await store.save();
}

export function startTracker(bot, store) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollOnce(bot, store);
    } catch (err) {
      console.error("tracker: tick failed:", err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, INTERVAL_MS);
  if (timer.unref) timer.unref();

  const first = setTimeout(tick, 10_000);
  if (first.unref) first.unref();

  console.log(
    `Трекер запущен: опрос каждые ${Math.round(INTERVAL_MS / 60000)} мин, подписок ${store.all().length}.`,
  );

  return timer;
}