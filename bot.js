const TelegramBot = require("node-telegram-bot-api");
const path = require("path");

const TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });

const CHANNEL = "@testing8287";

// 🔹 ONE-TIME CHANNEL POST
bot.sendMessage(
  CHANNEL,
  "🔥 NEON TYPER\nTyping animation project",
  {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📦 Source Code",
            url: "https://t.me/devsquebot?start=neon_typer"
          }
        ]
      ]
    }
  }
);

// 🔹 HANDLE DEEP LINK
bot.onText(/\/start (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const payload = match[1];

  if (payload === "neon_typer") {
    const filePath = path.join(__dirname, "Neon-Typer.zip");

    bot.sendDocument(chatId, filePath, {
      caption:
        "🔥 NEON TYPER\n" +
        "HTML • CSS • JavaScript\n\n" +
        "Source code ZIP attached."
    });
  }
});
