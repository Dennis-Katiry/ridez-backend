const http = require('http');
const app = require('./app');
const port = process.env.PORT || 4000;
const { initializeSocket } = require('./socket');

const server = http.createServer(app);
const io = initializeSocket(server); // Store the io instance

// Pass io to the app for use in controllers
app.set('socketio', io);

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Log when Socket.IO is ready
io.on('connection', (socket) => {
  console.log(`Socket.IO client connected: ${socket.id}`);
});