export const CATEGORIES = ["experience", "melee", "distance", "magic", "defense"];

// event key -> highscores category
export const RANK_CATEGORIES = {
  rank_exp: "experience",
  rank_melee: "melee",
  rank_distance: "distance",
  rank_magic: "magic",
  rank_defense: "defense",
};

const BASE = "https://www.rucoyonline.com";
const UA = { "User-Agent": "Mozilla/5.0 (rucoy-tg-bot)" };
const cache = new Map();

async function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: now, value });
  return value;
}

export function parseBorn(born) {
  if (!born) return null;
  const d = new Date(born);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export async function getCharacter(name) {
  const snap = await fetchSnapshot(name);
  if (!snap) return { ok: false, class: "input", reason: "character not found" };
  return {
    ok: true,
    profile: {
      name: snap.name,
      level: snap.level,
      guild: snap.guild,
      title: snap.title,
      status: snap.lastOnline,
      born: snap.born,
    },
  };
}

export async function getCohortRank(name, year, month) {
  const wanted = name.toLowerCase();
  return Promise.all(
    CATEGORIES.map(async (category) => {
      try {
        const list = await cached(
          `cohort:${category}:${year}:${month}`,
          10 * 60 * 1000,
          () => fetchHighscoresTable(`/highscores/${category}/${year}/${month}`),
        );
        const hit = list.find((x) => x.name.toLowerCase() === wanted);
        return { category, rank: hit ? hit.rank : null, value: hit ? hit.value : null };
      } catch (err) {
        return { category, rank: null, error: err.message };
      }
    }),
  );
}

// Parse a highscores table (global, or a "born since" cohort) into rows.
export async function fetchHighscoresTable(path) {
  const res = await fetch(`${BASE}${path}`, { headers: UA });
  if (!res.ok) return [];
  const html = await res.text();
  const table = html.match(
    /<table[^>]*class="[^"]*table-highscores[^"]*"[^>]*>[\s\S]*?<\/table>/i,
  );
  if (!table) return [];

  const out = [];
  for (const row of table[0].split(/<tr[^>]*>/i).slice(1)) {
    const cells = row
      .split(/<td[^>]*>/i)
      .slice(1)
      .map((part) => stripHtml(part.split(/<\/td>/i)[0]));
    if (cells.length < 2 || !/^\d+$/.test(cells[0])) continue;
    const nameMatch = row.match(/<a href="\/characters\/[^"]*">([\s\S]*?)<\/a>/i);
    out.push({
      rank: Number(cells[0]),
      name: nameMatch ? stripHtml(nameMatch[1]) : cells[1],
      value: cells[cells.length - 1] ?? null,
    });
  }
  return out;
}

export function fetchCategoryTop(category) {
  return fetchHighscoresTable(`/highscores/${category}`);
}

export function fetchCohortTop(category, year, month) {
  return fetchHighscoresTable(`/highscores/${category}/${year}/${month}`);
}

export async function getGlobalRanks(name) {
  const wanted = name.toLowerCase();
  const entries = await Promise.all(
    Object.entries(RANK_CATEGORIES).map(async ([key, category]) => {
      try {
        const list = await cached(`top:${category}`, 5 * 60 * 1000, () =>
          fetchCategoryTop(category),
        );
        const hit = list.find((x) => x.name.toLowerCase() === wanted);
        return [key, hit ? { rank: hit.rank, value: hit.value } : null];
      } catch {
        return [key, null];
      }
    }),
  );
  return Object.fromEntries(entries);
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchGuildPage(guildName) {
  const res = await fetch(`${BASE}/guild/${encodeURIComponent(guildName)}`, {
    headers: UA,
  });
  if (!res.ok) return null;
  return res.text();
}

function parseInfoTable(html) {
  const table = html.match(
    /<table[^>]*class="[^"]*character-table[^"]*"[^>]*>[\s\S]*?<\/table>/i,
  );
  if (!table) return null;
  const info = {};
  for (const row of table[0].split(/<tr[^>]*>/i).slice(1)) {
    const cells = row
      .split(/<td[^>]*>/i)
      .slice(1)
      .map((part) => stripHtml(part.split(/<\/td>/i)[0]));
    if (cells.length >= 2) info[cells[0]] = cells[1];
  }
  return info;
}

function stripRelativeTime(text) {
  const i = text.lastIndexOf(" - ");
  return i >= 0 ? text.slice(0, i).trim() : text;
}

function parseActivity(html) {
  const tables = [
    ...html.matchAll(
      /<table[^>]*class="[^"]*character-table[^"]*"[^>]*>[\s\S]*?<\/table>/gi,
    ),
  ];
  if (tables.length < 2) return [];
  let body = tables[1][0];
  const theadEnd = body.indexOf("</thead>");
  if (theadEnd >= 0) body = body.slice(theadEnd);
  const out = [];
  for (const row of body.split(/<tr[^>]*>/i).slice(1)) {
    const cell = row.split(/<td[^>]*>/i)[1];
    if (!cell) continue;
    const text = stripHtml(cell.split(/<\/td>/i)[0]);
    if (!text) continue;
    out.push(stripRelativeTime(text));
  }
  return out;
}

// One HTTP request per player gives everything the tracker needs:
// profile fields, the online flag, and recent PvP activity.
export async function fetchSnapshot(name) {
  const res = await fetch(`${BASE}/characters/${encodeURIComponent(name)}`, {
    headers: UA,
  });
  if (!res.ok) return null;
  const html = await res.text();
  const info = parseInfoTable(html);
  if (!info || !info.Name) return null;

  const lastOnline = info["Last online"] || null;
  return {
    name: info.Name,
    level: info.Level ?? null,
    guild: info.Guild || null,
    title: info.Title || null,
    lastOnline,
    online: /currently online/i.test(lastOnline ?? ""),
    born: info.Born ?? null,
    activity: parseActivity(html),
  };
}

export async function getGuildInfo(guildName, memberName) {
  if (!guildName) return null;
  try {
    const html = await fetchGuildPage(guildName);
    if (!html) return null;

    const tbStart = html.indexOf("<tbody");
    const tbEnd = html.indexOf("</tbody>");
    const body = tbStart >= 0 && tbEnd > tbStart ? html.slice(tbStart, tbEnd) : html;

    const members = [];
    for (const row of body.split(/<tr[^>]*>/i).slice(1)) {
      const nameMatch = row.match(/<a href="\/characters\/[^"]*">([\s\S]*?)<\/a>/i);
      if (!nameMatch) continue;
      // The site often omits the closing </td> on the "join date" cell,
      // so split on opening tags instead of matching full <td>…</td> pairs.
      const cells = row
        .split(/<td[^>]*>/i)
        .slice(1)
        .map((part) => stripHtml(part.split(/<\/td>/i)[0]));
      members.push({
        name: stripHtml(nameMatch[1]),
        level: cells[1] ?? null,
        joined: cells[2] ?? null,
      });
    }

    const foundedMatch = html.match(/Founded on\s+([^<]+)/);
    const wanted = memberName.toLowerCase();
    const me = members.find((m) => m.name.toLowerCase() === wanted);

    return {
      name: guildName,
      memberCount: members.length,
      joined: me?.joined ?? null,
      level: me?.level ?? null,
      founded: foundedMatch ? foundedMatch[1].trim() : null,
    };
  } catch {
    return null;
  }
}