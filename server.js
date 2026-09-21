const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { CATEGORIES } = require("./data/categories");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ROUND_DURATION_MS = 5 * 60 * 1000; // 5 dakika
const SPY_OPTION_COUNT = 10; // casusun göreceği evren seçeneği sayısı
const CUSTOM_CATEGORY_KEY = "ozel";
const MIN_CUSTOM_UNIVERSES = 8; // "Kendi Listeniz" kategorisinin oynanabilmesi için gereken min. madde
const MAX_CUSTOM_UNIVERSES = 60;

app.use(express.static(path.join(__dirname, "public")));

// ---- Yardımcı fonksiyonlar --------------------------------------------

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
//   code, hostId, players: Map<playerId, {id,name,connected,score}>,
//   selectedCategories: string[], state: 'lobby'|'playing'|'voting'|'ended',
//   universe, categoryKey, spyId, roundEndsAt, roundTimeout,
//   votes: Map<voterId, targetId>, spyGuessed
// }
const lobbies = new Map();

function publicPlayers(lobby) {
  return Array.from(lobby.players.values()).map((p) => ({
    id: p.id,
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

function endRoundBySpyGuess(lobby, correct) {
  clearRoundTimer(lobby);
  lobby.state = "ended";
  const spy = lobby.players.get(lobby.spyId);
  io.to(lobby.code).emit("round_result", {
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
    players: publicPlayers(lobby).filter((p) => p.id !== lobby.spyId || true), // herkes oy kullanabilir (casus dahil, isterse)
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

  if (spyCaught && spy) spy.score += 0; // casus yakalandı, puan vermiyoruz (basit tutuyoruz)
  if (!spyCaught) {
    // sivillerin hepsine değil, basitlik için sadece genel skor tutmuyoruz
  }

  io.to(lobby.code).emit("round_result", {
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

// ---- Socket.io olayları --------------------------------------------

io.on("connection", (socket) => {
  socket.data.lobbyCode = null;

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
    const lobby = {
      code,
      hostId: socket.id,
      players: new Map(),
      selectedCategories: ["oyun", "film", "dizi"],
      state: "lobby",
      universe: null,
      categoryKey: null,
      spyId: null,
      roundEndsAt: null,
      roundTimeout: null,
      votes: new Map(),
      customUniverses: [],
    };
    lobby.players.set(socket.id, { id: socket.id, name, connected: true, score: 0 });
    lobbies.set(code, lobby);

    socket.join(code);
    socket.data.lobbyCode = code;

    if (typeof cb === "function") cb({ success: true, code, playerId: socket.id });
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
    lobby.players.set(socket.id, { id: socket.id, name, connected: true, score: 0 });
    socket.join(code);
    socket.data.lobbyCode = code;

    if (typeof cb === "function") cb({ success: true, code, playerId: socket.id, hostId: lobby.hostId });
    socket.emit("custom_list_update", { list: lobby.customUniverses });
    broadcastLobby(lobby);
  });

  socket.on("select_categories", ({ code, categories }) => {
    const lobby = lobbies.get(code);
    if (!lobby || socket.id !== lobby.hostId) return;
    const valid = (categories || []).filter((c) => CATEGORIES[c] || c === CUSTOM_CATEGORY_KEY);
    lobby.selectedCategories = valid.length ? valid : lobby.selectedCategories;
    broadcastLobby(lobby);
  });

  socket.on("add_custom_universe", ({ code, value }) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== "lobby") return;
    if (!lobby.players.has(socket.id)) return;
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

  socket.on("remove_custom_universe", ({ code, index }) => {
    const lobby = lobbies.get(code);
    if (!lobby || socket.id !== lobby.hostId) return;
    if (typeof index !== "number" || index < 0 || index >= lobby.customUniverses.length) return;
    lobby.customUniverses.splice(index, 1);
    io.to(lobby.code).emit("custom_list_update", { list: lobby.customUniverses });
  });

  socket.on("start_game", ({ code }) => {
    const lobby = lobbies.get(code);
    if (!lobby || socket.id !== lobby.hostId) return;
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
    lobby.universe = universe;
    lobby.spyId = spy.id;
    lobby.votes = new Map();
    lobby.roundEndsAt = Date.now() + ROUND_DURATION_MS;

    // Casusun göreceği seçenekler: doğru evren + aynı kategoriden diğerleri
    const others = pool.filter((u) => u !== universe);
    const distractors = pickRandom(others, Math.min(SPY_OPTION_COUNT - 1, others.length));
    const spyOptions = shuffle([universe, ...distractors]);

    const categoryMeta =
      categoryKey === CUSTOM_CATEGORY_KEY
        ? { label: "Kendi Listeniz", emoji: "✍️" }
        : CATEGORIES[categoryKey];

    for (const p of players) {
      const isSpy = p.id === spy.id;
      io.to(p.id).emit("game_started", {
        role: isSpy ? "spy" : "citizen",
        categoryLabel: categoryMeta.label,
        categoryEmoji: categoryMeta.emoji,
        universe: isSpy ? null : universe,
        options: isSpy ? spyOptions : null,
        roundEndsAt: lobby.roundEndsAt,
        durationMs: ROUND_DURATION_MS,
      });
    }

    broadcastLobby(lobby);

    clearRoundTimer(lobby);
    lobby.roundTimeout = setTimeout(() => autoStartVoteOnTimeout(lobby), ROUND_DURATION_MS);
  });

  socket.on("spy_guess", ({ code, guess }) => {
    const lobby = lobbies.get(code);
    if (!lobby || lobby.state !== "playing") return;
    if (socket.id !== lobby.spyId) return;
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
    if (!lobby.players.has(socket.id)) return;
    lobby.votes.set(socket.id, targetId);

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
    if (!lobby || lobby.state !== "voting" || socket.id !== lobby.hostId) return;
    tallyVotesAndFinish(lobby, "host_ended");
  });

  socket.on("new_round", ({ code }) => {
    const lobby = lobbies.get(code);
    if (!lobby || socket.id !== lobby.hostId) return;
    lobby.state = "lobby";
    lobby.universe = null;
    lobby.spyId = null;
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
    if (!code) return;
    const lobby = lobbies.get(code);
    if (!lobby) return;

    const player = lobby.players.get(socket.id);
    if (player) {
      if (isDisconnect) {
        player.connected = false;
      } else {
        lobby.players.delete(socket.id);
      }
    }
    socket.leave(code);
    socket.data.lobbyCode = null;

    // Lobi boşaldıysa temizle
    if (Array.from(lobby.players.values()).every((p) => !p.connected)) {
      clearRoundTimer(lobby);
      lobbies.delete(code);
      return;
    }

    // Host ayrıldıysa yeni host ata
    if (lobby.hostId === socket.id) {
      const nextHost = Array.from(lobby.players.values()).find((p) => p.connected);
      if (nextHost) lobby.hostId = nextHost.id;
    }

    broadcastLobby(lobby);
  }
});

server.listen(PORT, () => {
  console.log(`Casus Kim sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
