const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ── 数据 ──────────────────────────────────────────
const rooms = new Map(); // code -> Room
let nextId = 1;

function genId() { return String(nextId++); }

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++)
      code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function broadcast(room, msg, exceptWs) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.ws !== exceptWs && p.ws.readyState === 1) p.ws.send(data);
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function playerInfo(p) {
  return { id: p.id, name: p.name, wins: p.wins };
}

function roomPlayers(room) {
  return [...room.players.values()].map(playerInfo);
}

function leaderboard(room) {
  return [...room.players.values()]
    .map(p => ({ name: p.name, wins: p.wins }))
    .sort((a, b) => b.wins - a.wins);
}

// ── WebSocket 处理 ────────────────────────────────
wss.on('connection', ws => {
  let player = null;
  let room = null;

  function sendErr(msg) { send(ws, { type: 'error', message: msg }); }

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

    // ── 设置昵称 ──
    case 'setName': {
      const name = String(msg.name || '').trim().slice(0, 12);
      if (!name) return sendErr('请输入昵称');
      if (!player) {
        player = { id: genId(), name, ws, wins: 0, attempts: 0, finished: false, lastGuessTime: 0 };
      } else {
        player.name = name;
      }
      break;
    }

    // ── 创建房间 ──
    case 'createRoom': {
      if (!player) return sendErr('请先设置昵称');
      if (room) return sendErr('你已在房间中');
      const code = genCode();
      room = {
        code, hostId: player.id,
        players: new Map([[player.id, player]]),
        state: 'lobby', answer: null, range: [1, 100], roundNumber: 0,
      };
      rooms.set(code, room);
      send(ws, { type: 'roomCreated', code, playerId: player.id, players: roomPlayers(room), hostId: room.hostId });
      break;
    }

    // ── 加入房间 ──
    case 'joinRoom': {
      if (!player) return sendErr('请先设置昵称');
      if (room) return sendErr('你已在房间中');
      const code = String(msg.code || '').toUpperCase().trim();
      const target = rooms.get(code);
      if (!target) return sendErr('房间不存在');
      if (target.state === 'playing') return sendErr('游戏进行中，无法加入');
      if (target.players.size >= 8) return sendErr('房间已满（最多8人）');

      room = target;
      player.attempts = 0;
      player.finished = false;
      room.players.set(player.id, player);

      send(ws, { type: 'roomJoined', code, playerId: player.id, players: roomPlayers(room), hostId: room.hostId });
      broadcast(room, { type: 'playerJoined', player: playerInfo(player) }, ws);
      break;
    }

    // ── 开始游戏 ──
    case 'startGame': {
      if (!room || !player) return sendErr('请先加入房间');
      if (room.hostId !== player.id) return sendErr('只有房主可以开始');
      if (room.players.size < 2) return sendErr('至少需要2名玩家');

      room.answer = Math.floor(Math.random() * 100) + 1;
      room.range = [1, 100];
      room.state = 'playing';
      room.roundNumber++;
      for (const p of room.players.values()) {
        p.attempts = 0;
        p.finished = false;
      }
      broadcast(room, { type: 'gameStarted', range: room.range, roundNumber: room.roundNumber });
      break;
    }

    // ── 猜数 ──
    case 'guess': {
      if (!room || !player) return sendErr('请先加入房间');
      if (room.state !== 'playing') return sendErr('游戏尚未开始');
      if (player.finished) return sendErr('你已猜中，请等待其他人');

      const now = Date.now();
      if (now - player.lastGuessTime < 200) return;
      player.lastGuessTime = now;

      const v = parseInt(msg.value, 10);
      if (isNaN(v) || v < room.range[0] || v > room.range[1])
        return sendErr(`请输入 ${room.range[0]}~${room.range[1]} 之间的整数`);

      player.attempts++;

      if (v === room.answer) {
        player.finished = true;
        player.wins++;
        room.state = 'roundEnd';
        broadcast(room, {
          type: 'roundEnd',
          winner: { id: player.id, name: player.name, attempts: player.attempts },
          answer: room.answer,
          leaderboard: leaderboard(room),
        });
      } else if (v < room.answer) {
        room.range[0] = Math.max(room.range[0], v + 1);
        broadcast(room, {
          type: 'guessResult', playerId: player.id, playerName: player.name,
          guess: v, hint: 'higher', range: [...room.range], attemptCount: player.attempts,
        });
      } else {
        room.range[1] = Math.min(room.range[1], v - 1);
        broadcast(room, {
          type: 'guessResult', playerId: player.id, playerName: player.name,
          guess: v, hint: 'lower', range: [...room.range], attemptCount: player.attempts,
        });
      }
      break;
    }

    // ── 下一轮 ──
    case 'nextRound': {
      if (!room || !player) return sendErr('请先加入房间');
      if (room.hostId !== player.id) return sendErr('只有房主可以开下一轮');
      if (room.state !== 'roundEnd') return sendErr('当前回合尚未结束');

      room.answer = Math.floor(Math.random() * 100) + 1;
      room.range = [1, 100];
      room.state = 'playing';
      room.roundNumber++;
      for (const p of room.players.values()) {
        p.attempts = 0;
        p.finished = false;
      }
      broadcast(room, { type: 'gameStarted', range: room.range, roundNumber: room.roundNumber });
      break;
    }

    // ── 离开房间 ──
    case 'leaveRoom': {
      leaveRoom();
      break;
    }
    }
  });

  ws.on('close', () => { leaveRoom(); });

  function leaveRoom() {
    if (!room || !player) return;
    room.players.delete(player.id);
    if (room.players.size === 0) {
      rooms.delete(room.code);
    } else {
      if (room.hostId === player.id) {
        room.hostId = room.players.values().next().value.id;
      }
      broadcast(room, { type: 'playerLeft', playerId: player.id, newHostId: room.hostId, players: roomPlayers(room) });
      if (room.state === 'playing' && room.players.size < 2) {
        room.state = 'roundEnd';
        broadcast(room, { type: 'roundEnd', winner: null, answer: room.answer, leaderboard: leaderboard(room), reason: '对手已断开' });
      }
    }
    room = null;
  }
});

// ── 启动 ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 猜数竞速服务器已启动: http://localhost:${PORT}`);
});
