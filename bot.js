// ===== imports =====
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

// ===== safety =====
process.on("unhandledRejection", err =>
  console.error("Unhandled rejection:", err)
);
process.on("uncaughtException", err =>
  console.error("Uncaught exception:", err)
);

// ===== env =====
const {
  BOT_TOKEN,
  ADMIN_ID,
  PORT = 3000,
  RENDER_EXTERNAL_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
} = process.env;

if (
  !BOT_TOKEN ||
  !ADMIN_ID ||
  !RENDER_EXTERNAL_URL ||
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_KEY
) {
  console.error("❌ Missing required environment variables");
  process.exit(1);
}

// ===== config =====
const CHANNEL_ID = -1003033363584; // numeric channel ID
const CHANNEL_NAME = "devsQUE";   // channel username (NO @)
const SUBSCRIBE_URL = "https://www.youtube.com/@devsQUE";

const DEFAULT_CAPTION =
  "🎉 Here’s your code!\n\n" +
  "Hope this helps 🙂\n" +
  "If you enjoyed it, don’t forget to like, share, and comment.\n\n" +
  "Thanks for your support!";

// ===== init =====
const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

// ===== webhook =====
bot.setWebHook(`${RENDER_EXTERNAL_URL}/bot${BOT_TOKEN}`);
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});
app.listen(PORT, () =>
  console.log("🤖 Bot running via webhook")
);

// ===== supabase =====
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);

// ===== helpers =====
const isAdmin = id => Number(id) === Number(ADMIN_ID);

async function isUserJoinedChannel(userId) {
  try {
    const member = await bot.getChatMember(CHANNEL_ID, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (err) {
    console.error("Channel check failed:", err.message);
    return false;
  }
}

// ===== state =====
let pending = null;

// ===================================================
// ================= USER FLOW =======================
// ===================================================

// /start payload
bot.onText(/\/start(?:\s(.+))?/, async (msg, match) => {
  const payload = match?.[1];

  if (!payload) {
    bot.sendMessage(
      msg.chat.id,
      "👋 Open a project from the channel to get the source code."
    );
    return;
  }

  // 🔒 CHECK CHANNEL JOIN
  const joined = await isUserJoinedChannel(msg.from.id);
  if (!joined) {
    bot.sendMessage(
      msg.chat.id,
      "🚫 You must join our channel to access source code.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📢 Join Channel",
                url: `https://t.me/${CHANNEL_NAME}`
              }
            ],
            [
              {
                text: "🔄 Try Again",
                url: `https://t.me/devsquebot?start=${payload}`
              }
            ]
          ]
        }
      }
    );
    return;
  }

  // 📦 FETCH PROJECT
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("payload", payload)
    .single();

  if (error || !data) {
    bot.sendMessage(msg.chat.id, "❌ Project not found.");
    return;
  }

  // ✅ SEND ZIP
  bot.sendDocument(msg.chat.id, data.zip_file_id, {
    caption: DEFAULT_CAPTION,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎬 Watch", url: data.watch_url }],
        [{ text: "🔔 Subscribe", url: SUBSCRIBE_URL }]
      ]
    }
  });
});

// ===================================================
// ================= ADMIN FLOW ======================
// ===================================================

// /publish payload | watch_url
bot.onText(/\/publish (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [payload, watch_url] =
    match[1].split("|").map(s => s.trim());

  if (!payload || !watch_url) {
    bot.sendMessage(msg.chat.id, "❌ Usage:\n/publish name | url");
    return;
  }

  const { data } = await supabase
    .from("projects")
    .select("payload")
    .eq("payload", payload)
    .single();

  if (data) {
    bot.sendMessage(msg.chat.id, "❌ Payload already exists.");
    return;
  }

  pending = { payload, watch_url };
  bot.sendMessage(msg.chat.id, "📦 Send ZIP file.");
});

// ZIP
bot.on("document", msg => {
  if (!pending || !isAdmin(msg.from.id)) return;

  pending.zip_file_id = msg.document.file_id;
  bot.sendMessage(msg.chat.id, "🖼 Send thumbnail image.");
});

// Thumbnail
bot.on("photo", msg => {
  if (!pending || !isAdmin(msg.from.id)) return;

  pending.thumb = msg.photo.at(-1).file_id;
  bot.sendMessage(msg.chat.id, "✍️ Send channel description.");
});

// Description + preview
bot.on("message", async msg => {
  if (!pending || !isAdmin(msg.from.id)) return;
  if (!msg.text || msg.text.startsWith("/")) return;

  pending.description = msg.text;

  await bot.sendPhoto(msg.chat.id, pending.thumb, {
    caption: pending.description,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "⚙️ Source Code",
            url: `https://t.me/devsquebot?start=${pending.payload}`
          }
        ],
        [
          { text: "🔔 Subscribe", url: SUBSCRIBE_URL },
          { text: "🎬 Watch", url: pending.watch_url }
        ],
        [
          { text: "✅ Publish", callback_data: "publish_ok" },
          { text: "❌ Cancel", callback_data: "publish_cancel" }
        ]
      ]
    }
  });
});

// Publish / Cancel
bot.on("callback_query", async q => {
  if (!pending || !isAdmin(q.from.id)) return;

  if (q.data === "publish_cancel") {
    pending = null;
    bot.sendMessage(q.message.chat.id, "❌ Publishing cancelled.");
    return;
  }

  if (q.data === "publish_ok") {
    const sent = await bot.sendPhoto(
      CHANNEL_ID,
      pending.thumb,
      {
        caption: pending.description,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "⚙️ Source Code",
                url: `https://t.me/devsquebot?start=${pending.payload}`
              }
            ],
            [
              { text: "🔔 Subscribe", url: SUBSCRIBE_URL },
              { text: "🎬 Watch", url: pending.watch_url }
            ]
          ]
        }
      }
    );

    await supabase.from("projects").insert({
      payload: pending.payload,
      zip_file_id: pending.zip_file_id,
      watch_url: pending.watch_url,
      channel_message_id: sent.message_id
    });

    pending = null;
    bot.sendMessage(q.message.chat.id, "✅ Project published.");
  }
});

// /projects (admin)
bot.onText(/\/projects$/, async msg => {
  if (!isAdmin(msg.from.id)) return;

  const { data } = await supabase
    .from("projects")
    .select("payload, channel_message_id")
    .order("created_at", { ascending: false });

  if (!data || !data.length) {
    bot.sendMessage(msg.chat.id, "📭 No projects found.");
    return;
  }

  const keyboard = data.map(p => ([
    {
      text: p.payload,
      url: `https://t.me/${CHANNEL_NAME}/${p.channel_message_id}`
    }
  ]));

  bot.sendMessage(msg.chat.id, "📦 Published projects:", {
    reply_markup: { inline_keyboard: keyboard }
  });
});
