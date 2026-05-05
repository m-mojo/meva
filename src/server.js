// Entry point — PM2 runs this file
// Starts: HTTP server + socket.io + biometric sync loop
require('./config/env'); // validates env vars before anything else

const http      = require('http');
const { Server } = require('socket.io');
const { createApp } = require('./app');
const bus       = require('./notifications/bus');
const { startSync } = require('./device/sync');
const { port }  = require('./config/env');

const app    = createApp();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

bus.init(io);

io.on('connection', (socket) => {
  console.log(`📋 [ws] client connected — ${socket.id}`);
  socket.on('disconnect', () => console.log(`📋 [ws] client disconnected — ${socket.id}`));
});

server.listen(port, () => {
  console.log(`✅ MINERVA running on port ${port}`);
  startSync();
});

server.on('error', (err) => {
  console.error(`❌ Server error: ${err.message}`);
  process.exit(1);
});
