const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");

/* ============================
   🔐 VARIABLES DEL BOT / META
=============================== */

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) throw new Error("Falta la variable BOT_TOKEN");

const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// 👑 Tu ID de Telegram (para /broadcast)
const ADMIN_ID = 7759212225;

/* ============================
   📁 DISK /data EN RENDER
=============================== */

const DATA_DIR = "/data"; // Render monta el disk aquí

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
    console.log("✅ Usuarios cargados al iniciar:", usuarios.length);
  } catch (e) {
    console.error("❌ Error leyendo usuarios.json:", e);
    usuarios = [];
  }
} else {
  console.log("ℹ️ usuarios.json no existe, se creará al guardar el primero.");
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
   Estructura: [{ chatId, email }]
=============================== */

let emails = [];

if (fs.existsSync(EMAILS_FILE)) {
  try {
    emails = JSON.parse(fs.readFileSync(EMAILS_FILE, "utf8"));
    console.log("✅ Emails cargados al iniciar:", emails.length);
  } catch (e) {
    console.error("❌ Error leyendo emails.json:", e);
    emails = [];
  }
} else {
  console.log("ℹ️ emails.json no existe, se creará al guardar el primero.");
}

function guardarEmails() {
  try {
    fs.writeFileSync(EMAILS_FILE, JSON.stringify(emails, null, 2));
    console.log("📩 Emails guardados:", emails.length);
  } catch (e) {
    console.error("❌ Error guardando emails:", e);
  }
}

function setEmail(chatId, email) {
  const idx = emails.findIndex((e) => e.chatId === chatId);
  if (idx === -1) {
    emails.push({ chatId, email });
  } else {
    emails[idx].email = email;
  }
  guardarEmails();
}

/* ============================
   🔒 HASH SHA256 PARA META
=============================== */

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/* ============================
   📡 ENVIAR EVENTO LEAD A META
   → Solo se envía si hay email.
=============================== */

async function enviarLeadMeta({ chatId, email }) {
  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    console.log("⚠️ Pixel o Token de Meta no configurados, no se envía evento.");
    return;
  }

  if (!email) {
    console.log("⛔ No se envía Lead: falta email.");
    return;
  }

  const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events`;

  const normalizedEmail = email.trim().toLowerCase();
  const emailHash = sha256(normalizedEmail);

  const user_data = {
    em: [emailHash],
    external_id: String(chatId),
    client_user_agent: "TelegramBot"
  };

  const payload = {
    data: [
      {
        event_name: "Lead", // o "CompleteRegistration", como prefieras
        event_time: Math.floor(Date.now() / 1000),
        action_source: "system_generated",
        user_data
      }
    ],
    access_token: META_ACCESS_TOKEN
  };

  try {
    const res = await axios.post(url, payload);
    console.log("📨 Lead enviado a Meta OK:", res.data);
  } catch (err) {
    console.error("❌ Error Meta CAPI:", err.response?.data || err.message);
  }
}

/* ============================
   🤖 BOT TELEGRAM
=============================== */

const bot = new TelegramBot(TOKEN, { polling: true });

/* ----- /start → registra usuario y pide email ----- */

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (!usuarios.includes(chatId)) {
    usuarios.push(chatId);
    guardarUsuarios();
  }

  bot.sendMessage(
    chatId,
    `¡Bienvenido/a! 👋🔥

Estás a un paso de activar tu BONO EXCLUSIVO DEL 100%, válido solo para nuevos jugadores.
Con este bono duplicamos tu primer depósito automáticamente.

Para generar tu cuenta necesito un dato:
👉 Decime tu email y te creo el usuario en 30 segundos`,
    { parse_mode: "Markdown" }
  );
});

/* ----- /broadcast <mensaje> (solo admin) ----- */

bot.onText(/\/broadcast (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ No tenés permiso para usar este comando.");
  }

  const mensaje = match[1];

  if (usuarios.length === 0) {
    bot.sendMessage(msg.chat.id, "⚠️ No hay usuarios registrados todavía.");
    return;
  }

  console.log("📢 Enviando broadcast a", usuarios.length, "usuarios");

  usuarios.forEach((id) => {
    bot
      .sendMessage(id, mensaje)
      .catch((e) => console.log("Error enviando a", id, "→", e.message || e));
  });

  bot.sendMessage(msg.chat.id, "✅ Broadcast enviado a todos los usuarios.");
});

/* ============================
   📧 CAPTURAR EMAIL Y ENVIAR LEAD
=============================== */

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  // ignorar comandos tipo /start, /broadcast, etc.
  if (!text || text.startsWith("/")) return;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(text)) {
    // si querés, podés no responder nada o decir "mandá un mail válido"
    return;
  }

  const email = text.toLowerCase();

  // Guardar email en /data/emails.json
  setEmail(chatId, email);

  // Enviar evento Lead a Meta con el email hasheado
  enviarLeadMeta({ chatId, email });

  bot.sendMessage(
    chatId,
    `✅ Perfecto, registré tu correo: *${email}*\n\nYa quedaste registrado como LEAD en nuestro sistema.`,
    { parse_mode: "Markdown" }
  );
});

/* ============================
   🌐 EXPRESS PARA RENDER
=============================== */

const app = express();

app.get("/", (req, res) => {
  res.send("Bot Telegram + Leads por email funcionando ✅");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🌍 Server listo en puerto", PORT);
});

module.exports = {};
