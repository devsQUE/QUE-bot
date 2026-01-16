// ===== imports =====
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const path = require("path");
const fs = require("fs");

process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err?.message || err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err?.message || err);
});


// ===== env =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL;

if (!TOKEN || !ADMIN_ID || !BASE_URL) {
  console.error("❌ Missing env vars");
  process.exit(1);
}

// ===== config =====
const CHANNEL_ID = -1003033363584;
const CHANNEL_NAME = "devsQUE";
const SUBSCRIBE_URL = "https://www.youtube.com/@devsQUE";

const DEFAULT_CAPTION =
  "🎉 Here’s your code!\n\n" +
  "Hope this helps 🙂\n" +
  "If you enjoyed it, don’t forget to like, share, and comment on the reel.\n\n" +
  "Thanks for your support!";

// ===== bot =====
const bot = new TelegramBot(TOKEN);

// ===== webhook server =====
const app = express();
app.use(express.json());

bot.setWebHook(`${BASE_URL}/bot${TOKEN}`);

app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log("🤖 Bot running via webhook");
});

// ===== helpers =====
const isAdmin = id => id === ADMIN_ID;

// ===== storage =====
const PROJECTS_FILE = path.join(__dirname, "projects.json");
let projects = {};

if (fs.existsSync(PROJECTS_FILE)) {
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, "utf8");
    projects = raw ? JSON.parse(raw) : {};
  } catch {
    projects = {};
  }
}

const save = () =>
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));

// ===== state =====
let pending = null;

// ===== /start =====
bot.onText(/\/start(?:\s(.+))?/, (msg, match) => {
  const payload = match?.[1];

  if (!payload) {
    bot.sendMessage(
      msg.chat.id,
      "👋 Open a project from the channel to get source code."
    );
    return;
  }

  const project = projects[payload];
  if (!project) {
    bot.sendMessage(msg.chat.id, "❌ Project not found.");
    return;
  }

  bot.sendDocument(msg.chat.id, project.zip, {
    caption: DEFAULT_CAPTION,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎬 Watch", url: project.watch }],
        [{ text: "🔔 Subscribe", url: SUBSCRIBE_URL }]
      ]
    }
  });
});

// ===== /projects (ADMIN) =====
bot.onText(/\/projects$/, msg => {
  if (!isAdmin(msg.from.id)) return;

  const keys = Object.keys(projects);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "📭 No projects yet.");
    return;
  }

  const kb = keys.map(k => ([
    { text: k, url: `https://t.me/${CHANNEL_NAME}/${projects[k].msg}` }
  ]));

  bot.sendMessage(msg.chat.id, "📦 Published projects:", {
    reply_markup: { inline_keyboard: kb }
  });
});

// ===== /publish =====
bot.onText(/\/publish (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [payload, watch] = match[1].split("|").map(s => s.trim());
  if (!payload || !watch) {
    bot.sendMessage(msg.chat.id, "❌ Usage: /publish name | url");
    return;
  }

  if (projects[payload]) {
    bot.sendMessage(msg.chat.id, "❌ Payload exists.");
    return;
  }

  pending = { payload, watch };
  bot.sendMessage(msg.chat.id, "📦 Send ZIP file.");
});

// ===== ZIP =====
bot.on("document", msg => {
  if (!pending || !isAdmin(msg.from.id)) return;

  pending.zip = msg.document.file_id;
  bot.sendMessage(msg.chat.id, "🖼 Send thumbnail.");
});

// ===== thumbnail =====
bot.on("photo", msg => {
  if (!pending || !isAdmin(msg.from.id)) return;

  pending.thumb = msg.photo.at(-1).file_id;
  bot.sendMessage(msg.chat.id, "✍️ Send channel description.");
});

// ===== description + preview =====
bot.on("message", async msg => {
  if (!pending || !isAdmin(msg.from.id)) return;
  if (msg.text?.startsWith("/")) return;

  const desc = msg.text;

  await bot.sendPhoto(msg.chat.id, pending.thumb, {
    caption: desc,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "⚙️ Source Code", url: `https://t.me/devsquebot?start=${pending.payload}` }
        ],
        [
          { text: "🔔 Subscribe", url: SUBSCRIBE_URL },
          { text: "🎬 Watch", url: pending.watch }
        ],
        [
          { text: "✅ Publish", callback_data: "ok" },
          { text: "❌ Cancel", callback_data: "no" }
        ]
      ]
    }
  });

  pending.desc = desc;
});

// ===== callbacks =====
bot.on("callback_query", async q => {
  if (!pending || !isAdmin(q.from.id)) return;

  if (q.data === "no") {
    pending = null;
    bot.sendMessage(q.message.chat.id, "❌ Cancelled.");
    return;
  }

  if (q.data === "ok") {
    const sent = await bot.sendPhoto(CHANNEL_ID, pending.thumb, {
      caption: pending.desc,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "⚙️ Source Code", url: `https://t.me/devsquebot?start=${pending.payload}` }
          ],
          [
            { text: "🔔 Subscribe", url: SUBSCRIBE_URL },
            { text: "🎬 Watch", url: pending.watch }
          ]
        ]
      }
    });

    projects[pending.payload] = {
      zip: pending.zip,
      watch: pending.watch,
      msg: sent.message_id
    };

    save();
    pending = null;
    bot.sendMessage(q.message.chat.id, "✅ Published.");
  }
});
