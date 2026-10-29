const MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const CATEGORY_LABELS = {
  experience: "Experience",
  melee: "Melee",
  distance: "Distance",
  magic: "Magic",
  defense: "Defense",
};

const RANK_LABELS = {
  rank_exp: "Experience",
  rank_melee: "Melee",
  rank_distance: "Distance",
  rank_magic: "Magic",
  rank_defense: "Defense",
};

export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
}

function formatGuild(profile, guildInfo) {
  if (!profile.guild) return "—";
  if (!guildInfo) return escapeHtml(profile.guild);

  const parts = [`<b>${escapeHtml(guildInfo.name)}</b>`];
  const details = [];
  details.push(`${guildInfo.memberCount} участников`);
  if (guildInfo.joined) details.push(`в составе с ${formatDate(guildInfo.joined)}`);
  if (guildInfo.founded) details.push(`основана ${formatDate(guildInfo.founded)}`);
  return `${parts[0]}\n   ${details.join(", ")}`;
}

export function formatProfile({ profile, guildInfo, cohort, globalRanks, born }) {
  const lines = [];

  lines.push(`🎮 <b>${escapeHtml(profile.name)}</b>`);
  lines.push(`Уровень: <b>${escapeHtml(profile.level ?? "—")}</b>`);
  lines.push(`Гильдия: ${formatGuild(profile, guildInfo)}`);
  lines.push(`Титул: ${escapeHtml(profile.title ?? "—")}`);
  lines.push(`Статус: ${escapeHtml(profile.status ?? "—")}`);
  lines.push(`Создан: ${escapeHtml(formatDate(profile.born) ?? "—")}`);

  if (born) {
    lines.push("");
    lines.push(`🏆 Рейтинги (созданные с ${String(born.month).padStart(2, "0")}/${born.year}):`);
    for (const entry of cohort) {
      const label = CATEGORY_LABELS[entry.category] ?? entry.category;
      if (entry.rank) {
        lines.push(`• ${label} — <b>#${entry.rank}</b> (${escapeHtml(entry.value)})`);
      } else {
        lines.push(`• ${label} — вне топ-100`);
      }
    }
  }

  lines.push("");
  const ranks = Object.entries(globalRanks ?? {}).filter(([, value]) => value);
  if (ranks.length) {
    const parts = ranks.map(
      ([key, value]) =>
        `${RANK_LABELS[key] ?? key} <b>#${value.rank}</b> (${escapeHtml(value.value)})`,
    );
    lines.push(`🌍 Общий топ-100: ${parts.join(", ")}`);
  } else {
    lines.push("🌍 Общий топ-100: вне списков");
  }

  return lines.join("\n");
}