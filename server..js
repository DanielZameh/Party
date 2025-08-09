// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// In-memory room store (for demo / small scale)
const rooms = {}; // roomId -> { hostId, players: {socketId: {name}}, language, layer }

function makeRoomId() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i=0;i<5;i++) id += chars[Math.floor(Math.random()*chars.length)];
  return id;
}

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('createRoom', ({name, language, layer}) => {
    let rid = makeRoomId();
    while (rooms[rid]) rid = makeRoomId();
    rooms[rid] = { hostId: socket.id, players: {}, language, layer, round:0 };
    rooms[rid].players[socket.id] = { name, ready:false };
    socket.join(rid);
    socket.emit('roomCreated', { roomId: rid });
    io.to(rid).emit('roomUpdate', rooms[rid]);
    console.log('room created', rid);
  });

  socket.on('joinRoom', ({roomId, name}) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('errorJoin', 'Room not found');
      return;
    }
    room.players[socket.id] = { name, ready:false };
    socket.join(roomId);
    io.to(roomId).emit('roomUpdate', room);
    console.log(name, 'joined', roomId);
  });

  socket.on('leaveRoom', ({roomId}) => {
    const room = rooms[roomId];
    if (!room) return;
    delete room.players[socket.id];
    socket.leave(roomId);
    if (Object.keys(room.players).length === 0) {
      delete rooms[roomId];
    } else {
      if (room.hostId === socket.id) {
        // pick new host
        room.hostId = Object.keys(room.players)[0];
      }
      io.to(roomId).emit('roomUpdate', room);
    }
  });

  socket.on('toggleReady', ({roomId}) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players[socket.id]) {
      room.players[socket.id].ready = !room.players[socket.id].ready;
      io.to(roomId).emit('roomUpdate', room);
    }
  });

  socket.on('startRound', ({roomId, seed}) => {
    const room = rooms[roomId];
    if (!room) return;
    // only host can start
    if (room.hostId !== socket.id) return;
    room.round += 1;
    // Server tells everyone to fetch a new prompt (client will request with language/layer)
    io.to(roomId).emit('roundStarted', { round: room.round, seed: seed || Date.now() });
  });

  socket.on('requestPrompt', ({roomId, type, language, layer}) => {
    // type: 'truth'|'dare'
    // to keep server-agnostic we trust client to pick; but server could validate or pick from DB.
    // For demo we ask clients to pick from local data.js based on this info and the host seed.
    // But to keep game fair, host may call this and others will receive the chosen prompt.
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostId !== socket.id) {
      // allow anyone to request, but host will broadcast chosen prompt
      // we'll broadcast the chosen prompt to all (assuming client sends prompt text)
      // client sends 'selectedPrompt' next.
      return;
    }
  });

  socket.on('selectedPrompt', ({roomId, promptObj}) => {
    // promptObj = {type, language, layer, text, hint?}
    io.to(roomId).emit('newPrompt', { prompt: promptObj, from: rooms[roomId]?.players[socket.id]?.name || 'Host' });
  });

  socket.on('chat', ({roomId, msg}) => {
    const room = rooms[roomId];
    if (!room) return;
    const name = room.players[socket.id]?.name || 'Anon';
    io.to(roomId).emit('chatMessage', { name, msg });
  });

  socket.on('disconnecting', () => {
    // remove the player from any rooms
    const joined = Array.from(socket.rooms).filter(r => r !== socket.id);
    joined.forEach(roomId => {
      const room = rooms[roomId];
      if (!room) return;
      delete room.players[socket.id];
      if (Object.keys(room.players).length === 0) {
        delete rooms[roomId];
      } else {
        if (room.hostId === socket.id) {
          room.hostId = Object.keys(room.players)[0];
        }
        io.to(roomId).emit('roomUpdate', room);
      }
    });
  });

});

http.listen(PORT, () => console.log('Server running on', PORT));
