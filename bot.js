import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import {
  getCharacter,
  getGuildInfo,
  getCohortRank,
  getGlobalRanks,
  parseBorn,
  fetchSnapshot,
} from "./data.js";
import { formatProfile, escapeHtml } from "./format.js";
import { TrackerStore, EVENT_KEYS } from "./store.js";
import { startTracker } from "./tracker.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error(
    "BOT_TOKEN не задан. Создай файл .env рядом с bot.js и добавь строку:\nBOT_TOKEN=123456:ABC...",
  );
  process.exit(1);
}

const EVENT_LABELS = {
  online: "Онлайн",
  level: "Уровень",
  guild: "Гильдия",
  title: "Титул",
  pvp: "PvP",
  rank_exp: "🏆 Опыт",
  rank_melee: "🏆 Melee",
  rank_distance: "🏆 Distance",
  rank_magic: "🏆 Magic",
  rank_defense: "🏆 Defense",
};

const store = await TrackerStore.load();
const bot = new Bot(token);

const HELP =
  "Отправь ник персонажа Rucoy Online — верну профиль, гильдию и места в топ-100.\n\n" +
  "Трекер:\n" +
  "/track &lt;ник&gt; — следить за игроком\n" +
  "/settings [ник] — включить/выключить события (в т.ч. топы Distance/Melee/Magic/Defense)\n" +
  "/list — мои трекеры\n" +
  "/untrack &lt;ник&gt; — убрать трекер\n\n" +
  "Пример:\n<code>Scimitron</code>";

function settingsText(sub) {
  const enabled =
    EVENT_KEYS.filter((k) => sub.events[k])
      .map((k) => EVENT_LABELS[k])
      .join(", ") || "ничего";
  return (
    `🔔 Трекер: <b>${escapeHtml(sub.name)}</b>\n` +
    `События: ${escapeHtml(enabled)}\n\n` +
    "Нажми кнопку, чтобы включить или выключить событие."
  );
}

function settingsKeyboard(sub) {
  const kb = new InlineKeyboard();
  for (let i = 0; i < EVENT_KEYS.length; i += 2) {
    for (const key of EVENT_KEYS.slice(i, i + 2)) {
      kb.text(`${sub.events[key] ? "✅" : "❌"} ${EVENT_LABELS[key]}`, `ev:${sub.id}:${key}`);
    }
    kb.row();
  }
  kb.text("🗑 Удалить трекер", `del:${sub.id}`);
  return kb;
}

async function lookup(ctx) {
  const name = (ctx.message?.text ?? "").trim().replace(/\s+/g, " ");
  if (!name) return;
  if (name.length > 64) return ctx.reply("Слишком длинный ник.");

  await ctx.replyWithChatAction("typing");

  const character = await getCharacter(name);
  if (!character.ok) {
    return ctx.reply(`Игрок «${escapeHtml(name)}» не найден в базе Rucoy Online.`);
  }

  const { profile } = character;
  const born = parseBorn(profile.born);

  const [guildInfo, cohort, globalRanks] = await Promise.all([
    getGuildInfo(profile.guild, profile.name),
    born ? getCohortRank(profile.name, born.year, born.month) : Promise.resolve([]),
    getGlobalRanks(profile.name),
  ]);

  const text = formatProfile({ profile, guildInfo, cohort, globalRanks, born });

  await ctx.reply(text, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

bot.command(["start", "help"], (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

bot.command("track", async (ctx) => {
  const name = (ctx.match ?? "").trim().replace(/\s+/g, " ");
  if (!name) return ctx.reply("Напиши ник: /track Scimitron");

  await ctx.replyWithChatAction("typing");
  const snap = await fetchSnapshot(name);
  if (!snap) return ctx.reply(`Игрок «${escapeHtml(name)}» не найден.`);

  const { sub, created, error } = store.add(ctx.chat.id, ctx.from?.id ?? 0, snap.name, snap);
  if (error || !sub) {
    return ctx.reply("Не удалось добавить: достигнут лимит трекеров в этом чате.");
  }
  await store.save();

  const prefix = created ? "✅ Трекер добавлен." : "🔔 Трекер уже был, обновил снимок.";
  await ctx.reply(`${prefix}\n\n${settingsText(sub)}`, {
    parse_mode: "HTML",
    reply_markup: settingsKeyboard(sub),
  });
});

bot.command("untrack", async (ctx) => {
  const name = (ctx.match ?? "").trim().replace(/\s+/g, " ");
  if (!name) return ctx.reply("Напиши ник: /untrack Scimitron");
  const sub = store.findByName(ctx.chat.id, name);
  if (!sub) return ctx.reply(`Трекера для «${escapeHtml(name)}» нет.`);
  store.remove(sub.id);
  await store.save();
  await ctx.reply(`🗑 Трекер для «${escapeHtml(sub.name)}» удалён.`, { parse_mode: "HTML" });
});

bot.command("list", async (ctx) => {
  const subs = store.byChat(ctx.chat.id);
  if (!subs.length) return ctx.reply("Трекеров пока нет. Добавь: /track Scimitron");

  const lines = subs.map((sub) => {
    const enabled =
      EVENT_KEYS.filter((k) => sub.events[k])
        .map((k) => EVENT_LABELS[k])
        .join(", ") || "ничего";
    const status = sub.snapshot?.online ? "🟢 онлайн" : "⚪ оффлайн";
    return `• <b>${escapeHtml(sub.name)}</b> — ${status}\n   ${escapeHtml(enabled)}`;
  });
  await ctx.reply(`Мои трекеры:\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
});

bot.command("settings", async (ctx) => {
  const name = (ctx.match ?? "").trim().replace(/\s+/g, " ");
  const sub = name ? store.findByName(ctx.chat.id, name) : store.byChat(ctx.chat.id)[0];
  if (!sub) return ctx.reply("Трекер не найден. Добавь: /track Scimitron");
  await ctx.reply(settingsText(sub), {
    parse_mode: "HTML",
    reply_markup: settingsKeyboard(sub),
  });
});

bot.callbackQuery(/^ev:([0-9a-f]+):([a-z_]+)$/, async (ctx) => {
  const [, id, key] = ctx.match;
  const sub = store.get(id);
  if (!sub || sub.chatId !== ctx.chat.id) return ctx.answerCallbackQuery("Не найдено");
  if (!EVENT_KEYS.includes(key)) return ctx.answerCallbackQuery();

  sub.events[key] = !sub.events[key];
  sub.updatedAt = Date.now();
  await store.save();
  await ctx.answerCallbackQuery(sub.events[key] ? "Включено" : "Выключено");
  await ctx.editMessageText(settingsText(sub), {
    parse_mode: "HTML",
    reply_markup: settingsKeyboard(sub),
  });
});

bot.callbackQuery(/^del:([0-9a-f]+)$/, async (ctx) => {
  const [, id] = ctx.match;
  const sub = store.get(id);
  if (!sub || sub.chatId !== ctx.chat.id) return ctx.answerCallbackQuery("Не найдено");
  store.remove(id);
  await store.save();
  await ctx.answerCallbackQuery("Удалено");
  await ctx.editMessageText(`🗑 Трекер для «${escapeHtml(sub.name)}» удалён.`, {
    parse_mode: "HTML",
  });
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) {
    return ctx.reply(HELP, { parse_mode: "HTML" });
  }
  try {
    await lookup(ctx);
  } catch (err) {
    console.error("lookup failed:", err);
    await ctx.reply("Не удалось получить данные с rucoyonline.com. Попробуй позже.");
  }
});

bot.catch((err) => {
  console.error("Bot error:", err.error ?? err);
});

startTracker(bot, store);

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

bot.start({
  onStart: (me) => console.log(`Бот @${me.username} запущен. Ctrl+C — остановка.`),
});