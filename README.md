<div align="center">
  <h1>Pico Chess ♟️</h1>
  <p><i>A lightning-fast, 6x6 multiplayer chess variant designed for the casual chess player.</i></p>

  <div>
    <img src="https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React Native" />
    <img src="https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white" alt="Expo" />
    <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
    <img src="https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Android" />
  </div>

  <br />

  <a href="https://play.google.com/store/apps/details?id=com.picochess.app">
    <img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" width="200" />
  </a>
</div>

---

## 🎯 The Problem

I am trying to make chess fun for casual players who are looking for a quick, stimulating puzzle during their free time.

Regular chess demands a massive time commitment, immense mental energy (an 8x8 board with 32 pieces requires aggressive calculation), and suffers from a rigid starting-moves theory problem where memorization wins over intuition. This creates heavy friction for casual players who just want to instinctively play the game without committing to 30 minutes of deep theory.

## ⚡ The Solution

**Pico Chess.** By condensing the board from 8x8 to 6x6 and reducing the initial piece count to 5 per side, the game reaches its end-state in a fraction of the time with significantly less cognitive load — while still feeling intensely intellectual.

The **"Drop Mechanic"** (placing captured pieces back onto the board, inspired by Shogi) destroys traditional opening-theory stagnation and creates an aggressive, highly tactical midgame that clicks instantly with casual users.

---

## ✨ Features

- **6x6 Crazyhouse variant** — 5 pieces per side (King, Rook, Knight, Bishop, Pawn) and a captured-piece drop mechanic
- **Online ranked play** — global Elo with progression tiers
- **PicoBot** — Easy / Medium / Hard, Alpha-Beta minimax with piece-square tables; runs offline
- **Private friend matches** — share a deep link, play unranked
- **Coin economy** — daily login bonus, match entry fees, victory rewards, in-app purchases via RevenueCat
- **Server-side push notifications** — waiting-room nudge, post-loss re-engagement, daily-coin reminder, Elo comeback nudge — all timezone-aware with quiet hours
- **30-second per-turn timer** — keeps games punchy
- **Pawn promotion** to Rook / Knight / Bishop (no Queen on a 6x6 board)
- **In-app review prompt** after a 3-win streak (90-day cooldown)

---

## 📜 Game Rules

Standard chess movement applies — but on a 6x6 board with 5 starting pieces per side, no castling, no en passant, no two-square pawn opening. Captured pieces enter your "hand" and can be dropped on any empty square as your move. Pawns can't be dropped on the promotion rank. Stalemate is a **loss** for the stalemated player. Draws happen only by mutual agreement.

See **[game-rules.md](./game-rules.md)** for the full specification.

---

## 🏗️ Architecture

| Layer | Stack | Role |
|---|---|---|
| **App** | React Native + Expo, react-native-reanimated, react-native-svg | UI, animations, SVG piece rendering |
| **Game engine** | Vanilla TypeScript (`src/core/GameEngine.ts`) | Deterministic move generation, validation, check/mate detection, drop handling — runs identically on both clients |
| **Database** | Supabase Postgres + RLS | Source of truth: profiles, matches, economy. Idempotent RPCs (`record_match_result`, `pay_bot_fee`, `pay_entry_fee`) handle atomic updates |
| **Realtime sync** | Supabase Realtime (WebSockets) | Broadcasts the serialized `game_state` JSONB column between peers, sub-50ms latency |
| **Bot** | `src/core/BotEngine.ts` | Alpha-Beta pruned minimax with piece-square tables and difficulty-tiered depth limits. Fully client-side |
| **Push** | Supabase Edge Functions + `expo-server-sdk` | Server-side cron-driven notifications |

---

## 🧠 Key Design Decisions

### Client-side determinism instead of authoritative game servers

Instead of paying for stateful game servers (Agones, Colyseus) that validate every move tick-by-tick, both clients run identical instances of `GameEngine.ts`. Supabase Realtime is a blind event relay. Backend infrastructure stays simple, server cost stays near zero, and global sync stays under ~50ms.

### Race-condition-immune economy and ratings

Matches conclude asynchronously across two devices, so it's common for the winner and a timeout-loser to write final state simultaneously. The Postgres RPCs are idempotent — the first call processes, sets an `already_processed` flag, and any second call short-circuits. No duplicate Elo, no negative coin states.

### Push-driven, not poll-driven

A Postgres webhook + Edge Function notifies the host's device via Expo push when an invited player joins their room — instead of forcing the app to poll the `matches` table on a heartbeat. Saves battery, reduces load.

### Offline viability

`BotEngine` and the rules engine ship in the JS bundle. A user with zero connectivity can still play the hardest bot — it executes the same logical paths as a fully-networked PvP match.

---

## 📁 Project Structure

```
mini-chess-multiplayer/
├── pico-chess-mobile/         # Expo React Native app
│   ├── src/
│   │   ├── core/              # GameEngine + BotEngine
│   │   ├── screens/           # Home, Game, Profile
│   │   ├── components/        # Board, pieces, modals
│   │   ├── services/          # Supabase, matchmaking, audio
│   │   ├── utils/             # elo, notifications, reviewPrompt
│   │   └── types/
│   └── supabase/functions/    # cron-reminders + per-match edge fns
├── supabase/                  # Top-level edge functions / SQL
├── game-rules.md
└── README.md
```

---

## 📄 License

No `LICENSE` file is present yet. All rights reserved by the author until one is added.
