// socket.io broadcast + 50-item in-memory ring buffer per event type
let io = null;
const ringBuffers = {};

function init(socketIo) {
  io = socketIo;
}

function emit(event, data) {
  if (!ringBuffers[event]) ringBuffers[event] = [];
  ringBuffers[event].push({ ...data, _ts: Date.now() });
  if (ringBuffers[event].length > 50) ringBuffers[event].shift();
  if (io) io.emit(event, data);
}

function getBuffer(event) {
  return ringBuffers[event] || [];
}

module.exports = { init, emit, getBuffer };
