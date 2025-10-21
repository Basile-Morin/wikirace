const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// route : GET /links/:title
app.get('/links/:title', async (req, res) => {
  try {
    const { title } = req.params;
    const url = `https://fr.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json`;

    const response = await axios.get(url);
    if (!response.data.parse) {
      return res.status(404).json({ error: 'Page introuvable' });
    }

    // On charge le HTML et on récupère les liens internes
    const html = response.data.parse.text['*'];
    const $ = cheerio.load(html);

    const links = [];
    $('a[href^="/wiki/"]').each((_, el) => {
      const href = $(el).attr('href');
      // on ignore les pages spéciales, fichiers, etc.
      if (href.match(/^\/wiki\/(Aide:|Fichier:|Spécial:|Discussion:|Catégorie:|Portail:|Modèle:)/)) return;
      const titleLink = decodeURIComponent(href.replace('/wiki/', '')).replace(/_/g, ' ');  //on enlève le /wki/ et on remplace le _ par des espaces
      links.push(titleLink);
    });

    res.json({ title, count: links.length, links });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/wiki/:title', async (req, res) => {
  try {
    const { title } = req.params;
    const url = `https://fr.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json`;

    const response = await axios.get(url);
    if (!response.data.parse) {
      return res.status(404).json({ error: 'Page introuvable' });
    }

    // On charge le HTML et on récupère les liens internes
    const html = response.data.parse.text['*'];
    const fullHtml = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <link rel="stylesheet" href="https://fr.wikipedia.org/w/load.php?modules=site.styles&only=styles">
        <link rel="stylesheet" href="https://fr.wikipedia.org/w/load.php?modules=skins.vector.styles&only=styles">
      </head>
      <body>
        ${html}
      </body>
      </html>
    `;
    res.send(fullHtml);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }

});

const rooms = {};


io.on('connection', (socket) => {
  console.log('joueur connecté', socket.id);

  socket.on('joinRoom', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms[roomId]) {
      rooms[roomId] = { players: {}, start: null, target: null };
    }
    rooms[roomId].players[socket.id] = { username, current: null, path: [] };

    console.log(`${username} a rejoint la room ${roomId}`);
    io.to(roomId).emit('roomUpdate', rooms[roomId]);
  });

  socket.on('startGame', ({ roomId, start, target }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].start = start;
    rooms[roomId].target = target;
    io.to(roomId).emit('gameStarted', { start, target });
  });

  socket.on('pageChange', ({ roomId, title }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].current = title;
    room.players[socket.id].path.push(title);

    if (title.toLowerCase() === room.target?.toLowerCase()) {
      io.to(roomId).emit('playerWon', { username: room.players[socket.id].username });
    } else {
      io.to(roomId).emit('roomUpdate', room);
    }
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      delete room.players[socket.id];
      io.to(roomId).emit('roomUpdate', room);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`✅ Server+WS on http://localhost:${PORT}`);
});


