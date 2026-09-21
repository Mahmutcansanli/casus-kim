const socket = io();

// ---- Durum ---------------------------------------------------------
let myId = null;
let myName = "";
let lobbyCode = null;
let isHost = false;
let lastLobbyState = null;
let selectedCategories = new Set(["oyun", "film", "dizi"]);
let categoryDefs = [];
let countdownInterval = null;
let currentRole = null; // 'spy' | 'citizen'
let hasVoted = false;

// ---- Ekran yönetimi --------------------------------------------------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function $(id) { return document.getElementById(id); }

// ---- Giriş ekranı -----------------------------------------------------
$("btn-goto-create").onclick = () => {
  myName = $("input-name").value.trim();
  if (!myName) { $("name-error").textContent = "Lütfen bir isim gir."; return; }
  $("name-error").textContent = "";
  socket.emit("create_lobby", { name: myName }, (res) => {
    if (!res.success) { $("name-error").textContent = res.error || "Bir hata oluştu."; return; }
    myId = res.playerId;
    lobbyCode = res.code;
    isHost = true;
    showScreen("screen-lobby");
  });
};

$("btn-goto-join").onclick = () => {
  myName = $("input-name").value.trim();
  if (!myName) { $("name-error").textContent = "Lütfen bir isim gir."; return; }
  $("name-error").textContent = "";
  showScreen("screen-join");
};

$("btn-back-1").onclick = () => showScreen("screen-name");

$("btn-join").onclick = () => {
  const code = $("input-code").value.trim().toUpperCase();
  if (!code) { $("join-error").textContent = "Kod gir."; return; }
  socket.emit("join_lobby", { code, name: myName }, (res) => {
    if (!res.success) { $("join-error").textContent = res.error || "Katılamadı."; return; }
    myId = res.playerId;
    lobbyCode = res.code;
    isHost = res.hostId === myId;
    $("join-error").textContent = "";
    showScreen("screen-lobby");
  });
};

// ---- Kategori seçimi ----------------------------------------------------
socket.emit("get_categories", (list) => {
  categoryDefs = list;
  const wrap = $("category-list");
  wrap.innerHTML = "";
  list.forEach((c) => {
    const chip = document.createElement("div");
    chip.className = "category-chip" + (selectedCategories.has(c.key) ? " selected" : "");
    chip.textContent = `${c.emoji} ${c.label}`;
    chip.dataset.key = c.key;
    chip.onclick = () => {
      if (!isHost) return;
      if (selectedCategories.has(c.key)) {
        if (selectedCategories.size === 1) return; // en az bir kategori kalsın
        selectedCategories.delete(c.key);
      } else {
        selectedCategories.add(c.key);
      }
      chip.classList.toggle("selected");
      socket.emit("select_categories", { code: lobbyCode, categories: Array.from(selectedCategories) });
    };
    wrap.appendChild(chip);
  });
});

$("btn-start-game").onclick = () => {
  socket.emit("start_game", { code: lobbyCode });
};

$("btn-leave-lobby").onclick = leaveLobby;
$("btn-leave-result").onclick = leaveLobby;

function leaveLobby() {
  socket.emit("leave_lobby");
  lobbyCode = null;
  isHost = false;
  stopCountdown();
  showScreen("screen-name");
}

// ---- Lobi güncellemesi ----------------------------------------------
socket.on("lobby_update", (data) => {
  lastLobbyState = data;
  isHost = data.hostId === myId;

  $("lobby-code-text").textContent = data.code;
  $("player-count").textContent = data.players.length;

  const list = $("player-list");
  list.innerHTML = "";
  data.players.forEach((p) => {
    const li = document.createElement("li");
    li.className = p.connected ? "" : "disconnected";
    li.innerHTML = `<span>${escapeHtml(p.name)}${p.id === myId ? " (Sen)" : ""}</span>` +
      (p.id === data.hostId ? '<span class="tag">HOST</span>' : "");
    list.appendChild(li);
  });

  if (data.state === "lobby") {
    $("host-controls").classList.toggle("hidden", !isHost);
    $("guest-waiting").classList.toggle("hidden", isHost);
    // Kategori seçimini sunucudan senkronize et
    selectedCategories = new Set(data.selectedCategories);
    document.querySelectorAll(".category-chip").forEach((chip) => {
      chip.classList.toggle("selected", selectedCategories.has(chip.dataset.key));
    });
    showScreen("screen-lobby");
  }
});

socket.on("error_message", (msg) => {
  $("lobby-error").textContent = msg;
  setTimeout(() => { $("lobby-error").textContent = ""; }, 4000);
});

// ---- Oyun başladı ----------------------------------------------------
let roundEndsAt = null;

socket.on("game_started", (data) => {
  currentRole = data.role;
  roundEndsAt = data.roundEndsAt;
  hasVoted = false;

  $("role-citizen").classList.toggle("hidden", data.role !== "citizen");
  $("role-spy").classList.toggle("hidden", data.role !== "spy");

  if (data.role === "citizen") {
    $("universe-box").textContent = `${data.categoryEmoji} ${data.universe}`;
  } else {
    const wrap = $("spy-options");
    wrap.innerHTML = "";
    data.options.forEach((opt) => {
      const div = document.createElement("div");
      div.className = "spy-option";
      div.textContent = opt;
      wrap.appendChild(div);
    });
  }

  showScreen("screen-game");
  startCountdown();
});

function startCountdown() {
  stopCountdown();
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 250);
}

function stopCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

function updateCountdown() {
  const remainingMs = Math.max(0, roundEndsAt - Date.now());
  const totalSec = Math.ceil(remainingMs / 1000);
  const min = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const sec = (totalSec % 60).toString().padStart(2, "0");
  const el = $("timer-text");
  el.textContent = `${min}:${sec}`;
  el.classList.toggle("low", totalSec <= 30);
  if (remainingMs <= 0) stopCountdown();
}

// ---- Casus tahmini ----------------------------------------------------
$("btn-spy-guess").onclick = () => {
  const wrap = $("spy-guess-options");
  wrap.innerHTML = "";
  document.querySelectorAll("#spy-options .spy-option").forEach((opt) => {
    const div = document.createElement("div");
    div.className = "spy-option clickable";
    div.textContent = opt.textContent;
    div.onclick = () => {
      socket.emit("spy_guess", { code: lobbyCode, guess: opt.textContent });
    };
    wrap.appendChild(div);
  });
  showScreen("screen-spy-guess");
};

$("btn-cancel-guess").onclick = () => showScreen("screen-game");

// ---- Oylama ----------------------------------------------------------
$("btn-start-vote").onclick = () => {
  socket.emit("start_vote", { code: lobbyCode });
};

socket.on("vote_started", (data) => {
  stopCountdown();
  hasVoted = false;
  $("btn-force-tally").classList.toggle("hidden", !isHost);
  $("vote-progress").textContent = `0 / ${data.players.filter(p => p.connected).length} oy verdi`;

  const list = $("vote-list");
  list.innerHTML = "";
  data.players.forEach((p) => {
    if (!p.connected) return;
    const li = document.createElement("li");
    li.textContent = p.name + (p.id === myId ? " (Sen)" : "");
    li.dataset.id = p.id;
    li.onclick = () => {
      if (hasVoted) return;
      hasVoted = true;
      document.querySelectorAll("#vote-list li").forEach((el) => el.classList.remove("voted-self"));
      li.classList.add("voted-self");
      socket.emit("cast_vote", { code: lobbyCode, targetId: p.id });
    };
    list.appendChild(li);
  });

  showScreen("screen-vote");
});

socket.on("vote_progress", (data) => {
  $("vote-progress").textContent = `${data.votesIn} / ${data.totalPlayers} oy verdi`;
});

$("btn-force-tally").onclick = () => {
  socket.emit("force_tally_votes", { code: lobbyCode });
};

// ---- Sonuç -------------------------------------------------------------
socket.on("round_result", (data) => {
  stopCountdown();
  const iAmSpy = data.spyId === myId;
  const spyWon = data.spyWon;
  const iWon = iAmSpy ? spyWon : !spyWon;

  $("result-title").textContent = iWon ? "🎉 Kazandın!" : "😔 Kaybettin";

  let reasonText = "";
  if (data.reason === "spy_guessed_correctly") reasonText = "Casus evreni doğru tahmin etti!";
  else if (data.reason === "spy_guessed_wrong") reasonText = "Casus evreni yanlış tahmin etti!";
  else if (data.reason === "timeout") reasonText = "Süre doldu, oylama yapıldı.";
  else reasonText = "Oylama tamamlandı.";

  let html = `<p class="result-line">${reasonText}</p>`;
  html += `<p class="result-line">Evren: <span class="result-highlight">${escapeHtml(data.universe)}</span></p>`;
  html += `<p class="result-line">Casus: <span class="result-highlight">${escapeHtml(data.spyName)}</span></p>`;
  if (data.accusedName) {
    html += `<p class="result-line">Oylamada suçlanan: <span class="result-highlight">${escapeHtml(data.accusedName)}</span></p>`;
  } else if (data.reason === "all_voted" || data.reason === "host_ended") {
    html += `<p class="result-line">Kimse net bir çoğunlukla suçlanmadı.</p>`;
  }
  html += `<p class="result-line ${spyWon ? "result-win" : "result-lose"}">${spyWon ? "Casus turu kazandı! 🕵️" : "Siviller turu kazandı! 👥"}</p>`;

  $("result-body").innerHTML = html;
  $("host-result-controls").classList.toggle("hidden", !isHost);
  $("guest-result-controls").classList.toggle("hidden", isHost);

  showScreen("screen-result");
});

$("btn-new-round").onclick = () => {
  socket.emit("new_round", { code: lobbyCode });
};

// ---- Yardımcı ----------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

socket.on("connect", () => { myId = socket.id; });
