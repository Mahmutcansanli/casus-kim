const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { CATEGORIES } = require("./data/categories");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DEFAULT_ROUND_DURATION_MS = 5 * 60 * 1000; // 5 dakika
const MIN_ROUND_MINUTES = 1;
const MAX_ROUND_MINUTES = 30;
const SPY_OPTION_COUNT = 10; // casusun göreceği evren seçeneği sayısı
const CUSTOM_CATEGORY_KEY = "ozel";
const MIN_CUSTOM_UNIVERSES = 8; // "Kendi Listeniz" kategorisinin oynanabilmesi için gereken min. madde
const MAX_CUSTOM_UNIVERSES = 60;
const DISCONNECT_GRACE_MS = 60 * 1000; // lobi tamamen boşalınca temizlemeden önce bekleme süresi

app.use(express.static(path.join(__dirname, "public")));

// ---- Yardımcı fonksiyonlar --------------------------------------------

function makeToken() {
  return crypto.randomBytes(12).toString("hex");
}

function makeLobbyCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // karışabilecek harfler yok
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (lobbies.has(code));
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, n) {
  return shuffle(arr).slice(0, n);
}

// ---- Oyun / Lobi durumu ------------------------------------------------
// lobbies: Map<code, Lobby>
// Lobby = {
//   code,
//   hostId,                 // host oyuncunun TOKEN'ı
//   players: Map<token, {token,name,connected,score,socketId}>,
//   selectedCategories: string[], state: 'lobby'|'playing'|'voting'|'ended',
//   universe, categoryKey, categoryMeta, spyId (TOKEN), spyOptions,
//   roundEndsAt, roundDurationMs, roundTimeout,
//   votes: Map<voterToken, targetToken>, customUniverses, lastResult,
// }
const lobbies = new Map();

function publicPlayers(lobby) {
  return Array.from(lobby.players.values()).map((p) => ({
    id: p.token,
    name: p.name,
    connected: p.connected,
    score: p.score,
  }));
}

function broadcastLobby(lobby) {
  io.to(lobby.code).emit("lobby_update", {
    code: lobby.code,
    hostId: lobby.hostId,
    players: publicPlayers(lobby),
    selectedCategories: lobby.selectedCategories,
    state: lobby.state,
    roundDurationMs: lobby.roundDurationMs,
  });
}

function activePlayers(lobby) {
  return Array.from(lobby.players.values()).filter((p) => p.connected);
}

function clearRoundTimer(lobby) {
  if (lobby.roundTimeout) {
    clearTimeout(lobby.roundTimeout);
    lobby.roundTimeout = null;
  }
}

function emitResult(lobby, payload) {
  lobby.lastResult = payload;
  io.to(lobby.code).emit("round_result", payload);
}

function endRoundBySpyGuess(lobby, correct) {
  clearRoundTimer(lobby);
  lobby.state = "ended";
  const spy = lobby.players.get(lobby.spyId);
  emitResult(lobby, {
    reason: correct ? "spy_guessed_correctly" : "spy_guessed_wrong",
    spyWon: correct,
    spyId: lobby.spyId,
    spyName: spy ? spy.name : "?",
    universe: lobby.universe,
    accusedId: null,
    accusedName: null,
  });
  broadcastLobby(lobby);
}

function autoStartVoteOnTimeout(lobby) {
  if (lobby.state !== "playing") return;
  lobby.state = "voting";
  lobby.votes = new Map();
  io.to(lobby.code).emit("vote_started", {
    players: publicPlayers(lobby),
    reason: "timeout",
  });
  broadcastLobby(lobby);
}

function tallyVotesAndFinish(lobby, reason) {
  clearRoundTimer(lobby);
  const counts = new Map();
  for (const targetId of lobby.votes.values()) {
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  let accusedId = null;
  let max = 0;
  let tie = false;
  for (const [id, c] of counts.entries()) {
    if (c > max) {
      max = c;
      accusedId = id;
      tie = false;
    } else if (c === max) {
      tie = true;
    }
  }
  if (tie) accusedId = null; // berabere -> kimse suçlanmadı sayılır, casus kazanır

  const spyCaught = accusedId === lobby.spyId;
  lobby.state = "ended";

  const spy = lobby.players.get(lobby.spyId);
  const accused = accusedId ? lobby.players.get(accusedId) : null;

  emitResult(lobby, {
    reason,
    spyWon: !spyCaught,
    spyId: lobby.spyId,
    spyName: spy ? spy.name : "?",
    universe: lobby.universe,
    accusedId,
    accusedName: accused ? accused.name : null,
    voteCounts: Array.from(counts.entries()).map(([id, c]) => ({
      id,
      name: lobby.players.get(id)?.name || "?",
      count: c,
    })),
  });
  broadcastLobby(lobby);
}

function scheduleEmptyLobbyCleanup(lobby) {
  setTimeout(() => {
    if (!lobbies.has(lobby.code)) return;
    const stillEmpty = Array.from(lobby.players.values()).every((p) => !p.connected);
    if (stillEmpty) {
      clearRoundTimer(lobby);
      lobbies.delete(lobby.code);
    }
  }, DISCONNECT_GRACE_MS);
}

// ---- Socket.io olayları --------------------------------------------

io.on("connection", (socket) => {
  socket.data.lobbyCode = null;
  socket.data.playerToken = null;

  socket.on("get_categories", (cb) => {
    const list = Object.entries(CATEGORIES).map(([key, v]) => ({
      key,
      label: v.label,
      emoji: v.emoji,
      count: v.universes.length,
    }));
    if (typeof cb === "function") cb(list);
  });

  socket.on("create_lobby", ({ name }, cb) => {
    name = (name || "").trim().slice(0, 20) || "Oyuncu";
    const code = makeLobbyCode();
    const token = makeToken();
    const lobby = {
      code,
      hostId: token,
      players: new Map(),
      selectedCategories: ["oyun", "film", "dizi"],
      state: "lobby",
      universe: null,
      categoryKey: null,
      categoryMeta: null,
      spyId: null,
      spyOptions: null,
      roundEndsAt: null,
      roundDurationMs: DEFAULT_ROUND_DURATION_MS,
      roundTimeout: null,
      votes: new Map(),
      customUniverses: [],
      lastResult: null,
    };
    lobby.players.set(token, { token, name, connected: true, score: 0, socketId: socket.id });
    lobbies.set(code, lobby);

    socket.join(code);
    socket.data.lobbyCode = code;
    socket.data.playerToken = token;

    if (typeof cb === "function") cb({ success: true, code, playerId: token });
    broadcastLobby(lobby);
  });

  socket.on("join_lobby", ({ code, name }, cb) => {
    code = (code || "").trim().toUpperCase();
    name = (name || "").trim().slice(0, 20) || "Oyuncu";
    const lobby = lobbies.get(code);
    if (!lobby) {
      if (typeof cb === "function") cb({ success: false, error: "Böyle bir oyun bulunamadı." });
      return;
    }
    if (lobby.state !== "lobby") {
      if (typeof cb === "function") cb({ success: false, error: "Oyun zaten başladı, katılamazsınız." });
      return;
    }
    const token = makeToken();
    lobby.players.set(token, { token, name, connected: true, score: 0, socketId: socket.id });
    socket.join(code);
    socket.data.lobbyCode = code;
    socket.data.playerToken = token;

    if (typeof cb === "function") cb({ success: true, code, playerId: token, hostId: lobby.hostId });
    socket.emit("custom_list_update", { list: lobby.customUniverses });
    broadcastLobby(lobby);
  });

  // Sayfa yenileme / bağlantı kopması sonrası aynı oyuncu kimliğiyle geri dönüş
  socket.on("rejoin_lobby", ({ code, token }, cb) => {
    code = (code || "").trim().toUpperCase();
    const lobby = lobbies.get(code);
    if (!lobby || !token || !lobby.players.has(token)) {
      if (typeof cb === "function") cb({ success: false });
      return;
    }
    const player = lobby.players.get(token);
    player.connected = true;
    player.socketId = socket.id;
    socket.join(code);
    socket.data.lobbyCode = code;
    socket.data.playerToken = token;

    if (typeof cb === "function") {
      cb({ success: true, code, playerId: token, hostId: lobby.hostId, name: player.name, state: lobby.state });
    }

    socket.emit("custom_list_update", { list: lobby.customUniverses });

    if (lobby.state === "playing" && lobby.categoryMeta) {
      const isSpy = token === lobby.spyId;
      socket.emit("game_started", {
        role: isSpy ? "spy" : "citizen",
        categoryLabel: lobby.categoryMeta.label,
        categoryEmoji: lobby.categoryMeta.emoji,
        universe: isSpy ? null : lobby.universe,
        options: isSpy ? lobby.spyOptions : null,
        roundEndsAt: lobby.roundEndsAt,
        durationMs: lobby.roundDurationMs,
      });
    } else if (lobby.state === "voting") {
      socket.emit("vote_started", { players: publicPlayers(lobby), reason: "rejoin" });
      socket.emit("vote_progress", {
        votesIn: lobby.votes.size,
        totalPlayers: activePlayers(lobby).length,
      });
    } else if (lobby.state === "ended" && lobby.lastResult) {
      socket.emit("round_result", lobby.lastResult);
    }

    broadcastLobby(lobby);
  });

  socket.on("select_categories", ({ code, categories }) => {
    const lobby = lobbies.get(code);
    if (!lobby || socket.data.playerToken !== lobby.hostId) return;
    const valid = (categories || []).filter((c) => CATEGORIES[c] || c === CUSTOM_CATEGORY_KEY);
    lobby.selectedCategories = valid.length ? valid : lobby.selectedCategories;
    broadcastLobby(lobby);
  });

  socket.on("set_round_duration", ({ code, minutes }) => {
    const lobby = lobbies.get(code);
    if (!lobby || socket.data.playerToken !== lobby.hostId) return;
    if (lobby.state !== "lobby") return;
    const m = Number(minutes);
    if (!Number.isFinite(m) || m < MIN_ROUND_MINUTES || m > MAX_ROUND_MINUTES) return;
    lobby.roundDurationMs = Math.round(m * 60 * 1000);
    broadcastLobby(lobby);
  });

  socket.on("add_custom_universe", ({ code, value }) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== "lobby") return;
    if (!lobby.players.has(socket.data.playerToken)) return;
    const clean = (value || "").trim().slice(0, 40);
    if (!clean) return;
    const exists = lobby.customUniverses.some((u) => u.toLowerCase() === clean.toLowerCase());
    if (exists) {
      socket.emit("error_message", "Bu isim zaten eklenmiş.");
      return;
    }
    if (lobby.customUniverses.length >= MAX_CUSTOM_UNIVERSES) {
      socket.emit("error_message", `Liste doldu (maksimum ${MAX_CUSTOM_UNIVERSES}).`);
      return;
    }
    lobby.customUniverses.push(clean);
    io.to(lobby.code).emit("custom_list_update", { list: lobby.customUniverses });
  });

  socket.on("add_custom_universes_bulk", ({ code, values }) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== "lobby") return;
    if (!lobby.players.has(socket.data.playerToken)) return;
    const arr = Array.isArray(values) ? values : [];
    let added = 0;
    for (const raw of arr) {
      if (lobby.customUniverses.length >= MAX_CUSTOM_UNIVERSES) break;
      const clean = (raw || "").trim().slice(0, 40);
      if (!clean) continue;
      const exists = lobby.customUniverses.some((u) => u.toLowerCase() === clean.toLowerCase());
      if (exists) continue;
      lobby.customUniverses.push(clean);
      added++;
    }
    if (added > 0) {
      io.to(lobby.code).emit("custom_list_update", { list: lobby.customUniverses });
    }
  });

  socket.on("remove_custom_universe", ({ code, index }) => {
    const lobby = lobbies.get(code);
    if (!lobby || socket.data.playerToken !== lobby.hostId) return;
    if (typeof index !== "number" || index < 0 || index >= lobby.customUniverses.length) return;
    lobby.customUniverses.splice(index, 1);
    io.to(lobby.code).emit("custom_list_update", { list: lobby.customUniverses });
  });

  socket.on("start_game", ({ code }) => {
    const lobby = lobbies.get(code);
    if (!lobby || socket.data.playerToken !== lobby.hostId) return;
    const players = activePlayers(lobby);
    if (players.length < 3) {
      socket.emit("error_message", "Oyuna başlamak için en az 3 oyuncu gerekiyor.");
      return;
    }
    if (!lobby.selectedCategories.length) {
      socket.emit("error_message", "En az bir kategori seçin.");
      return;
    }

    // "Kendi Listeniz" kategorisi yeterli maddeye sahip değilse o turluk devre dışı bırak
    const effectiveCategories = lobby.selectedCategories.filter((c) => {
      if (c === CUSTOM_CATEGORY_KEY) return lobby.customUniverses.length >= MIN_CUSTOM_UNIVERSES;
      return true;
    });
    if (!effectiveCategories.length) {
      const onlyCustomSelected =
        lobby.selectedCategories.length === 1 && lobby.selectedCategories[0] === CUSTOM_CATEGORY_KEY;
      const msg = onlyCustomSelected
        ? `"Kendi Listeniz" için en az ${MIN_CUSTOM_UNIVERSES} isim ekleyin (şu an ${lobby.customUniverses.length}/${MIN_CUSTOM_UNIVERSES}).`
        : "En az bir kategori seçin.";
      socket.emit("error_message", msg);
      return;
    }

    // Kategori ve evren seç
    const categoryKey = effectiveCategories[Math.floor(Math.random() * effectiveCategories.length)];
    const pool = categoryKey === CUSTOM_CATEGORY_KEY ? lobby.customUniverses : CATEGORIES[categoryKey].universes;
    const universe = pool[Math.floor(Math.random() * pool.length)];

    // Casus seç
    const spy = players[Math.floor(Math.random() * players.length)];

    lobby.state = "playing";
    lobby.categoryKey = categoryKey;
    lobby.categoryMeta =
      categoryKey === CUSTOM_CATEGORY_KEY ? { label: "Kendi Listeniz", emoji: "✍️" } : CATEGORIES[categoryKey];
    lobby.universe = universe;
    lobby.spyId = spy.token;
    lobby.votes = new Map();
    lobby.roundEndsAt = Date.now() + lobby.roundDurationMs;
    lobby.lastResult = null;

    // Casusun göreceği seçenekler: doğru evren + aynı kategoriden diğerleri
    const others = pool.filter((u) => u !== universe);
    const distractors = pickRandom(others, Math.min(SPY_OPTION_COUNT - 1, others.length));
    lobby.spyOptions = shuffle([universe, ...distractors]);

    for (const p of players) {
      const isSpy = p.token === spy.token;
      io.to(p.socketId).emit("game_started", {
        role: isSpy ? "spy" : "citizen",
        categoryLabel: lobby.categoryMeta.label,
        categoryEmoji: lobby.categoryMeta.emoji,
        universe: isSpy ? null : universe,
        options: isSpy ? lobby.spyOptions : null,
        roundEndsAt: lobby.roundEndsAt,
        durationMs: lobby.roundDurationMs,
      });
    }

    broadcastLobby(lobby);

    clearRoundTimer(lobby);
    lobby.roundTimeout = setTimeout(() => autoStartVoteOnTimeout(lobby), lobby.roundDurationMs);
  });

  socket.on("spy_guess", ({ code, guess }) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== "playing") return;
    if (socket.data.playerToken !== lobby.spyId) return;
    const correct = (guess || "").trim() === lobby.universe;
    endRoundBySpyGuess(lobby, correct);
  });

  socket.on("start_vote", ({ code }) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== "playing") return;
    clearRoundTimer(lobby);
    lobby.state = "voting";
    lobby.votes = new Map();
    io.to(lobby.code).emit("vote_started", {
      players: publicPlayers(lobby),
      reason: "manual",
    });
    broadcastLobby(lobby);
  });

  socket.on("cast_vote", ({ code, targetId }) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== "voting") return;
    const voterToken = socket.data.playerToken;
    if (!lobby.players.has(voterToken)) return;
    lobby.votes.set(voterToken, targetId);

    const activeCount = activePlayers(lobby).length;
    io.to(lobby.code).emit("vote_progress", {
      votesIn: lobby.votes.size,
      totalPlayers: activeCount,
    });

    if (lobby.votes.size >= activeCount) {
      tallyVotesAndFinish(lobby, "all_voted");
    }
  });

  socket.on("force_tally_votes", ({ code }) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== "voting" || socket.data.playerToken !== lobby.hostId) return;
    tallyVotesAndFinish(lobby, "host_ended");
  });

  socket.on("new_round", ({ code }) => {
    const lobby = lobbies.get(code);
    if (!lobby || socket.data.playerToken !== lobby.hostId) return;
    lobby.state = "lobby";
    lobby.universe = null;
    lobby.spyId = null;
    lobby.spyOptions = null;
    lobby.categoryMeta = null;
    lobby.lastResult = null;
    lobby.votes = new Map();
    clearRoundTimer(lobby);
    broadcastLobby(lobby);
  });

  socket.on("leave_lobby", () => {
    handleDisconnect(socket, false);
  });

  socket.on("disconnect", () => {
    handleDisconnect(socket, true);
  });

  function handleDisconnect(socket, isDisconnect) {
    const code = socket.data.lobbyCode;
    const token = socket.data.playerToken;
    if (!code || !token) return;
    const lobby = lobbies.get(code);
    if (!lobby) return;

    const player = lobby.players.get(token);
    if (player) {
      if (isDisconnect) {
        player.connected = false;
      } else {
        lobby.players.delete(token);
      }
    }
    socket.leave(code);
    socket.data.lobbyCode = null;
    socket.data.playerToken = null;

    // Lobi boşaldıysa hemen silme; yeniden bağlanma için biraz bekle
    if (Array.from(lobby.players.values()).every((p) => !p.connected)) {
      scheduleEmptyLobbyCleanup(lobby);
      broadcastLobby(lobby);
      return;
    }

    // Host ayrıldıysa / koptuysa yeni host ata
    if (lobby.hostId === token) {
      const nextHost = Array.from(lobby.players.values()).find((p) => p.connected);
      if (nextHost) lobby.hostId = nextHost.token;
    }

    broadcastLobby(lobby);
  }
});

server.listen(PORT, () => {
  console.log(`Casus Kim sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
