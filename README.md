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
**Pico Chess.** By mathematically condensing the board from 8x8 to 6x6 and reducing the initial piece count, the game reaches its end-state in a fraction of the time with significantly less cognitive load while still feeling intensely intellectual. 

By simplifying the board geometry and introducing the **"Drop Mechanic"** (placing captured pieces back onto the board, heavily inspired by Shogi), it destroys traditional opening-theory stagnation and creates an aggressive, highly tactical midgame that clicks instantly with casual users.

---

## 🏗️ High-Level System Architecture (HLD)

### 1. Frontend App (React Native)
The UI is built entirely natively using Expo. It leverages `react-native-reanimated` for smooth 60 FPS piece dropping and interpolations, maintaining a pseudo-3D (2.5D) visual projection mapping natively over SVG vectors to ensure high-performance rendering across all budget mobile devices.

### 2. Core Chess Validation Engine
A completely detached, deterministic logical engine (`GameEngine.ts`) built entirely in Vanilla TypeScript. It natively handles all absolute legal move generation, validation, check/checkmate detection, and unique Pocket piece mathematical handling. By isolating the engine entirely from React's render cycles, it runs asynchronously without dropping UI frames.

### 3. Backend & Database Infrastructure (Supabase PostgreSQL)
The core storage and authoritative source. RLS (Row Level Security) policies intrinsically secure individual player profiles. It leverages highly complex Postgres RPCs (`record_match_result`, `pay_bot_fee`, `pay_entry_fee`) to handle atomic row updates for the global economy (coins), Elo tier ranking variations, and match lifecycle evaluations robustly.

### 4. Game State Sync Engine (Supabase Realtime)
WebSockets connect the React Native clients seamlessly to designated active `matches` rows inside Postgres. Physical changes to the serialized `game_state` JSONB column are instantly broadcast bi-directionally between peers handling latency bounds efficiently under ~50ms globally.

### 5. PicoBot AI Engine
A highly complex, completely localized AI opponent implementing Alpha-Beta Pruned Minimax algorithms. It operates asynchronously strictly within the JS thread utilizing Piece-Square Tables (PST) and Probabilistic Blunder matrices mapped against algorithmic depth limits (Easy/Medium/Hard) yielding engaging automated resistance without ever touching a single backend server GPU.

---

## 🧠 Key Design Decisions

### Client-Side Determinism vs. Stateful Backend Processing
Instead of standing up and paying heavily for expensive specialized backend game servers (like Agones or Colyseus) that constantly compute and validate every single chess move tick by tick, Pico Chess shifts the execution entirely. Both mobile clients run identically deterministic instances of the `GameEngine`. Supabase Realtime simply acts as a blind event relay pipe, vastly simplifying backend infrastructure and drastically cutting server costs while guaranteeing sub-50ms sync globally.

### Race Condition Immunity in Economy & Ratings
Because matches conclude asynchronously across remote devices, it is incredibly common for both clients (e.g., the Winner and a Timeout Loser) to attempt to write final rankings simultaneously back to the database. By designing natively idempotent Supabase Postgres RPCs using locked `already_processed` boolean flags, the backend physically locks the matching transaction upon execution. The exact instant White claims an Elo reward, the database fundamentally seals itself, natively preventing race conditions from duplicating rank inflation or creating negative coin defects.

### Asynchronous Push Mechanics Over Client Polling
Leveraging Edge Functions tightly linked via Postgres Database Webhooks, the backend autonomously observes when an invited player accepts a deeply-linked room invitation asynchronously. It triggers `expo-server-sdk` push tokens strictly server-side, awaking host devices organically with a high-priority notification rather than forcing the React Native application to burn battery by executing constant physical heartbeat loops polling the `matches` API.

### Offline & Disconnected Viability
Because the `BotEngine` and Core Ruleset are bundled directly into the compiled JavaScript payload, playing against PicoBot natively detaches from Realtime WebSockets completely. A user standing in a subway tunnel with zero cell reception can generate an isolated instance of `GameEngine.ts` and play against the hardest bot difficulty intuitively, executing exactly identical logical parameters to a fully networked 5G PvP instance.
