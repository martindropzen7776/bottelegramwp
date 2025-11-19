const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

/* ============================
   🔐 VARIABLES DEL BOT / META
=============================== */

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("Falta la variable BOT_TOKEN");

const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

const ADMIN_ID = 7759212225; // tu ID de Telegram

/* ============================
   📁 CONFIGURAR DISK DE RENDER
=============================== */

const DATA_DIR = "/data"; // Render Disk
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, "usuarios.json");
const EMAILS_FILE = path.join(DATA_DIR, "emails.json");

console.log("📂 Archivo usuarios:", USERS_FILE);
console.log("📂 Archivo emails:", EMAILS_FILE);

/* ============================
   📌 CARGAR USUARIOS
=============================== */

let usuarios = [];
if (fs.existsSync(USERS_FILE)) {
  try {
    usuarios = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    console.log("✅ Usuarios cargados:", usuarios.length);
  } catch {
    usuarios = [];
  }
}

function guardarUsuarios() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usuarios, null, 2));
    console.log("💾 Guardados usuarios:", usuarios.length);
  } catch (e) {
    console.error("❌ Error guardando usuarios:", e);
  }
}

/* ============================
   📌 CARGAR EMAILS
=============================== */

let emails = [];
if (fs.existsSync(EMAILS_FILE)) {
  try {
    emails = JSON.parse(fs.readFileSync(EMAILS_FILE, "utf8"));
    console.log("📧 Emails cargados:", emails.length);
  } catch {
    emails = [];
  }
}

function guardarEmails() {
  try {
    fs.writeFileSync(EMAILS_FILE, JSON.stringify(emails, null, 2));
    console.log("📩 Emails guardados:", emails.length);
  } catch (e) {
    console.error("❌ Error guardando emails:", e);
  }
}

/* ============================
   📡 ENVIAR EVENTO A META (CAPI)
=============================== */

async function enviarEventoMeta({ eventName, chatId, email }) {
  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    console.log("⚠️ No está configurado el Pixel o Access Token");
    return;
  }

  const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events`;

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        user_data: {
          em: email ? [email] : undefined,
          client_user_agent: `telegram_chat_${chatId}`
        }
      }
    ],
    access_token: META_ACCESS_TOKEN
  };

  try {
    const res = await axios.post(url, payload);
    console.log("📨 Enviado a Meta:", res.data);
  } catch (err) {
    console.error("❌ Error Meta CAPI:", err.response?.data || err.message);
  }
}

/* ============================
   🤖 INICIAR BOT
=============================== */

const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (!usuarios.includes(chatId)) {
    usuarios.push(chatId);
    guardarUsuarios();
  }

  // Enviar evento Lead
  enviarEventoMeta({ eventName: "Lead", chatId, email: null });

  bot.sendMessage(
    chatId,
    `👋 ¡Bienvenido/a!

Ya estás registrado y empezás a recibir bonos y alertas exclusivas 🎁

📧 Si querés recibir beneficios también por email,
enviame tu correo (por ejemplo: tunombre@gmail.com).

🍀 ¡Mucha suerte!`
  );
});

/* ============================
   📢 BROADCAST
=============================== */

bot.onText(/\/broadcast (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID)
    return bot.sendMessage(msg.chat.id, "❌ No tenés permiso.");

  const mensaje = match[1];
  usuarios.forEach((id) =>
    bot.sendMessage(id, mensaje).catch((e) => console.log("Error:", e.message))
  );

  bot.sendMessage(msg.chat.id, "✅ Broadcast enviado.");
});

/* ============================
   📧 DETECTAR EMAILS AUTOMÁTICO
=============================== */

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  if (!text || text.startsWith("/")) return;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (emailRegex.test(text)) {
    const email = text.toLowerCase();

    const exist = emails.find((e) => e.chatId === chatId);
    if (exist) exist.email = email;
    else emails.push({ chatId, email });

    guardarEmails();

    // Evento CompleteRegistration
    enviarEventoMeta({ eventName: "CompleteRegistration", chatId, email });

    bot.sendMessage(chatId, `📩 Email guardado: ${email}`);
  }
});

/* ============================
   🌐 EXPRESS PARA RENDER
=============================== */

const app = express();
app.get("/", (req, res) => res.send("Bot funcionando en Render"));
app.listen(process.env.PORT || 10000, () => console.log("🌍 Server listo"));

module.exports = {};
