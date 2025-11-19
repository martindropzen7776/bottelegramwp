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

// 👑 Tu ID de Telegram (para /broadcast)
const ADMIN_ID = 7759212225;

/* ============================
   📁 DISK /data EN RENDER
=============================== */

// Render monta el disk en /data
const DATA_DIR = "/data";

const USERS_FILE = path.join(DATA_DIR, "usuarios.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

console.log("📂 Archivo usuarios:", USERS_FILE);
console.log("📂 Archivo sesiones:", SESSIONS_FILE);

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
   📌 CARGAR SESIONES (fbp/fbc)
=============================== */

let sessions = [];

if (fs.existsSync(SESSIONS_FILE)) {
  try {
    sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
    console.log("✅ Sesiones cargadas al iniciar:", sessions.length);
  } catch (e) {
    console.error("❌ Error leyendo sessions.json:", e);
    sessions = [];
  }
} else {
  console.log("ℹ️ sessions.json no existe, se creará al guardar la primera sesión.");
}

function guardarSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    console.log("💾 Sesiones guardadas:", sessions.length);
  } catch (e) {
    console.error("❌ Error guardando sesiones:", e);
  }
}

/* ============================
   📡 ENVIAR LEAD A META (CAPI)
   → Siempre manda evento Lead.
   → Si hay fbp/fbc los usa, si no, manda con IP/UA/external_id mínimo.
=============================== */

async function enviarLeadMeta({ chatId, fbp, fbc }) {
  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    console.log("⚠️ Pixel o Token de Meta no configurados, no se envía evento.");
    return;
  }

  const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events`;

  // Datos mínimos que siempre mandamos
  const user_data = {
    client_ip_address: "1.1.1.1",      // IP dummy aceptada por Meta
    client_user_agent: "TelegramBot",  // UA fijo
    external_id: String(chatId)        // ID interno del usuario
  };

  // Si tenemos datos reales desde la landing, suman para el matching
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;

  const payload = {
    data: [
      {
        event_name: "Lead",
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

/* ----- /start (con o sin sessionId) ----- */
// /start
// /start asdasd123123 (desde la landing)
bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const sessionId = match[1]; // puede venir de la landing

  if (!usuarios.includes(chatId)) {
    usuarios.push(chatId);
    guardarUsuarios();
  }

  let fbp = null;
  let fbc = null;

  if (sessionId) {
    const sess = sessions.find((s) => s.sessionId === sessionId);
    if (sess) {
      fbp = sess.fbp || null;
      fbc = sess.fbc || null;
      console.log(
        `🔗 Start con sessionId=${sessionId} → fbp=${fbp || "-"} fbc=${fbc || "-"}`
      );
    } else {
      console.log(
        `⚠️ sessionId ${sessionId} no encontrado, se envía Lead igual sin fbp/fbc`
      );
    }
  } else {
    console.log("ℹ️ /start sin sessionId (usuario entró directo al bot).");
  }

  // SIEMPRE enviamos Lead a Meta, tenga o no fbp/fbc
  enviarLeadMeta({ chatId, fbp, fbc });

  bot.sendMessage(
    chatId,
    `👋 ¡Bienvenido/a!

Ya quedaste registrado en nuestro bot oficial. Desde ahora, cada vez que alguien entra desde la landing y toca START, lo contamos como LEAD.`
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
   🌐 EXPRESS PARA LANDING + HEALTHCHECK
=============================== */

const app = express();

// Para leer JSON del body
app.use(express.json());

// Endpoint donde la landing guarda sessionId + fbp/fbc
// POST /api/telegram-session
// body: { sessionId, fbp, fbc }
app.post("/api/telegram-session", (req, res) => {
  const { sessionId, fbp, fbc } = req.body || {};

  if (!sessionId) {
    console.log("❌ /api/telegram-session sin sessionId:", req.body);
    return res.status(400).json({ ok: false, error: "Falta sessionId" });
  }

  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx === -1) {
    sessions.push({ sessionId, fbp: fbp || null, fbc: fbc || null });
  } else {
    sessions[idx] = { sessionId, fbp: fbp || null, fbc: fbc || null };
  }

  guardarSessions();
  console.log("✅ Sesión guardada:", sessionId, "fbp:", fbp || "-", "fbc:", fbc || "-");
  res.json({ ok: true });
});

// Healthcheck
app.get("/", (req, res) => {
  res.send("Bot Telegram + Meta CAPI funcionando ✅");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🌍 Server listo en puerto", PORT);
});

module.exports = {};
