// ===== imports =====
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const path = require("path");
const fs = require("fs");

// ===== config =====
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

if (!TOKEN || !ADMIN_ID) {
  console.error("❌ Missing BOT_TOKEN or ADMIN_ID");
  process.exit(1);
}

// Channel config
const CHANNEL_ID = -1003311885654;   // numeric channel ID
const CHANNEL_NAME = "testing8287";  // channel username (no @)
const SUBSCRIBE_URL = "https://www.youtube.com/@devsQUE";

const DEFAULT_CAPTION =
  "🎉 Here’s your code!\n\n" +
  "Hope this helps 🙂\n" +
  "If you enjoyed it, don’t forget to like, share, and leave a comment on the reel " +
  "so others know you received the code via Telegram.\n\n" +
  "Thanks a lot for your support!";

// ===== init bot =====
const bot = new TelegramBot(TOKEN);

// ===== webhook server =====
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const URL = process.env.RENDER_EXTERNAL_URL;

if (!URL) {
  console.error("❌ RENDER_EXTERNAL_URL not set");
  process.exit(1);
}

bot.setWebHook(`${URL}/bot${TOKEN}`);

app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log("🤖 Bot running via webhook");
});

// ===== helpers =====
const isAdmin = (id) => id === ADMIN_ID;

// ===== persistence (SAFE JSON HANDLING) =====
const PROJECTS_FILE = path.join(__dirname, "projects.json");

let projects = {};

// define BEFORE use (important)
const saveProjects = () => {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
};

if (fs.existsSync(PROJECTS_FILE)) {
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, "utf-8").trim();
    projects = raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("⚠️ Corrupted projects.json, resetting...");
    projects = {};
  }
}

// always ensure file exists
saveProjects();

// ===== state =====
let pendingPublish = null;

// ===== /start (USER) =====
bot.onText(/\/start(?:\s(.+))?/, (msg) => {
  const payload = msg.match?.[1];

  if (!payload) return;

  const project = projects[payload];
  if (!project) {
    bot.sendMessage(msg.chat.id, "❌ Project not found.");
    return;
  }

  bot.sendDocument(msg.chat.id, project.zipFileId, {
    caption: DEFAULT_CAPTION,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎬 Watch", url: project.watchUrl }],
        [{ text: "🔔 Subscribe", url: SUBSCRIBE_URL }]
      ]
    }
  });
});

// ===== /publish (ADMIN) =====
// Format: /publish payload | watch_url
bot.onText(/\/publish (.+)/, (msg) => {
  if (!isAdmin(msg.from.id)) return;

  const parts = msg.match[1].split("|").map(p => p.trim());
  if (parts.length !== 2) {
    bot.sendMessage(msg.chat.id, "❌ Usage:\n/publish payload | watch_url");
    return;
  }

  const [payload, watchUrl] = parts;

  if (projects[payload]) {
    bot.sendMessage(msg.chat.id, "❌ Payload already exists.");
    return;
  }

  pendingPublish = { payload, watchUrl };
  bot.sendMessage(msg.chat.id, "📦 Send ZIP file.");
});

// ===== receive ZIP =====
bot.on("document", (msg) => {
  if (!pendingPublish || !isAdmin(msg.from.id)) return;

  pendingPublish.zipFileId = msg.document.file_id;
  bot.sendMessage(msg.chat.id, "🖼 Send thumbnail image.");
});

// ===== receive thumbnail =====
bot.on("photo", (msg) => {
  if (!pendingPublish || !isAdmin(msg.from.id)) return;

  pendingPublish.thumbFileId = msg.photo.at(-1).file_id;
  bot.sendMessage(msg.chat.id, "✍️ Send channel description.");
});

// ===== description → PREVIEW =====
bot.on("message", async (msg) => {
  if (
    !pendingPublish ||
    !isAdmin(msg.from.id) ||
    msg.chat.type !== "private" ||
    !msg.text ||
    msg.text.startsWith("/")
  ) return;

  pendingPublish.description = msg.text;

  const { payload, watchUrl, thumbFileId, description } = pendingPublish;

  await bot.sendPhoto(msg.chat.id, thumbFileId, {
    caption: description,
    reply_markup: {
      inline_keyboard: [
        [{ text: "⚙️ Source Code", url: `https://t.me/devsquebot?start=${payload}` }],
        [
          { text: "🔔 Subscribe", url: SUBSCRIBE_URL },
          { text: "🎬 Watch", url: watchUrl }
        ],
        [
          { text: "✅ Publish", callback_data: "publish_confirm" },
          { text: "❌ Cancel", callback_data: "publish_cancel" }
        ]
      ]
    }
  });
});

// ===== callbacks =====
bot.on("callback_query", async (q) => {
  if (!pendingPublish || !isAdmin(q.from.id)) return;

  const chatId = q.message.chat.id;

  if (q.data === "publish_cancel") {
    pendingPublish = null;
    bot.sendMessage(chatId, "❌ Publishing cancelled.");
    return;
  }

  if (q.data === "publish_confirm") {
    const { payload, watchUrl, zipFileId, thumbFileId, description } = pendingPublish;

    const sent = await bot.sendPhoto(CHANNEL_ID, thumbFileId, {
      caption: description,
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚙️ Source Code", url: `https://t.me/devsquebot?start=${payload}` }],
          [
            { text: "🔔 Subscribe", url: SUBSCRIBE_URL },
            { text: "🎬 Watch", url: watchUrl }
          ]
        ]
      }
    });

    projects[payload] = {
      zipFileId,
      watchUrl,
      channelMessageId: sent.message_id
    };

    saveProjects();
    pendingPublish = null;

    bot.sendMessage(chatId, "✅ Project published.");
  }
});

// ===== /projects (ADMIN) =====
bot.onText(/\/projects$/, (msg) => {
  if (!isAdmin(msg.from.id)) return;

  const keyboard = Object.entries(projects)
    .filter(([_, p]) => p.channelMessageId)
    .map(([key, p]) => ([
      {
        text: key,
        url: `https://t.me/${CHANNEL_NAME}/${p.channelMessageId}`
      }
    ]));

  if (!keyboard.length) {
    bot.sendMessage(msg.chat.id, "📭 No projects found.");
    return;
  }

  bot.sendMessage(msg.chat.id, "📦 Published Projects:", {
    reply_markup: { inline_keyboard: keyboard }
  });
});
