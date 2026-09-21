// "Casus Kim" oyunu için kategori ve evren (universe) verileri.
// Her kategori bir "tema" ve o temaya ait, oyuncuların tahmin edeceği
// bir "evren" (universe) listesi içerir.

const CATEGORIES = {
  oyun: {
    label: "Oyun",
    emoji: "🎮",
    universes: [
      "Minecraft", "Valorant", "League of Legends", "Fortnite", "GTA V",
      "Among Us", "FIFA", "Counter-Strike", "The Legend of Zelda",
      "Super Mario", "Pokémon", "Overwatch", "Red Dead Redemption",
      "Elden Ring", "Roblox", "Call of Duty",
    ],
  },
  film: {
    label: "Film",
    emoji: "🎬",
    universes: [
      "Star Wars", "Harry Potter", "Yüzüklerin Efendisi", "Marvel (Avengers)",
      "Matrix", "Jurassic Park", "John Wick", "Indiana Jones",
      "Karayip Korsanları", "Hızlı ve Öfkeli", "Transformers",
      "Kara Şövalye (Batman)", "James Bond", "Terminator", "Şrek", "Frozen",
    ],
  },
  dizi: {
    label: "Dizi",
    emoji: "📺",
    universes: [
      "Game of Thrones", "Breaking Bad", "Stranger Things", "The Office",
      "Friends", "La Casa de Papel", "Kara Sevda", "Diriliş Ertuğrul",
      "Vikings", "The Walking Dead", "Peaky Blinders", "Sherlock",
      "Black Mirror", "Suits", "The Crown", "Narcos",
    ],
  },
  unluler: {
    label: "Ünlüler",
    emoji: "⭐",
    universes: [
      "Cristiano Ronaldo", "Lionel Messi", "Elon Musk", "Taylor Swift",
      "Kim Kardashian", "Tarkan", "Mustafa Kemal Atatürk", "Albert Einstein",
      "Michael Jackson", "Ronaldinho", "Kobe Bryant", "Steve Jobs",
      "Leonardo DiCaprio", "Beyoncé", "Nikola Tesla", "Mozart",
    ],
  },
  meslekler: {
    label: "Meslekler",
    emoji: "👔",
    universes: [
      "Doktor", "Öğretmen", "Polis", "İtfaiyeci", "Avukat", "Mühendis",
      "Aşçı (Şef)", "Pilot", "Berber", "Terzi", "Eczacı", "Veteriner",
      "Mimar", "Gazeteci", "Müzisyen", "Çiftçi",
    ],
  },
  mekanlar: {
    label: "Klasik Mekanlar",
    emoji: "📍",
    universes: [
      "Hastane", "Okul", "Uzay İstasyonu", "Plaj", "Sirk", "Banka",
      "Kruvaziyer Gemisi", "Restoran", "Havaalanı", "Casino", "Elçilik",
      "Tiyatro", "Polis Karakolu", "Süpermarket", "Otel", "Askeri Üs",
    ],
  },
};

module.exports = { CATEGORIES };
