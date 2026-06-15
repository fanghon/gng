# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A multiplayer online number guessing racing game (多人在线猜数竞速游戏). Players join rooms via 6-character codes, compete to guess a hidden number (1-100), and share a narrowing range — when one player guesses wrong, the range tightens for everyone. First to guess correctly wins the round. Leaderboard tracks wins across rounds.

## Commands

```bash
npm install          # install dependencies (express, ws)
npm start            # start server on port 3000
node server.js       # alternative: run directly
```

No build step, linter, or test framework is configured. Testing is manual — open multiple browser tabs to `http://localhost:3000`.

## Architecture

**Stack**: Node.js + Express (static files) + `ws` (WebSocket). Two dependencies total.

**Files**:
- `server.js` — All server logic (~225 lines): room management, WebSocket message handling, game state
- `public/index.html` — Multiplayer client (~413 lines): 4 screens (entry, lobby, game, result), WebSocket client
- `caishu.html` — Original single-player version (preserved, not served)
- `guess.html` — Another single-player variant (preserved, not served)
- `多人在线猜数竞速游戏 — 实施计划.md` — Implementation plan (Chinese)

**Server state** (`server.js`):
- `rooms: Map<code, Room>` — in-memory room store
- `Room`: `{ code, hostId, players: Map, state, answer, range, roundNumber }`
- `Player`: `{ id, name, ws, wins, attempts, finished, lastGuessTime }`
- Room states: `lobby` → `playing` → `roundEnd` → `playing` (next round)
- Auto-cleanup: empty rooms deleted on disconnect; host transfers if host leaves

**WebSocket protocol** (JSON messages):
- Client → Server: `setName`, `createRoom`, `joinRoom`, `startGame`, `guess`, `nextRound`, `leaveRoom`
- Server → Client: `roomCreated`, `roomJoined`, `playerJoined`, `playerLeft`, `gameStarted`, `guessResult`, `roundEnd`, `error`

**Key mechanics**:
- Shared range narrows for all players on any wrong guess
- 200ms rate limit per player on guesses
- Room codes exclude ambiguous characters (0/O, 1/I)
- Max 8 players per room, min 2 to start
- Rounds continue until host stops or <2 players remain

**Client** (`public/index.html`):
- 4 screens toggled via `.screen` / `.screen.active` CSS classes
- Auto-reconnects WebSocket on close (2s delay)
- Keyboard Enter support on all input fields
