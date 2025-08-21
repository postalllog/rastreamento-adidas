    import express from "express";
    import http from "http";
    import { Server } from "socket.io";
    import cors from "cors";

  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
  origin: "*",
      methods: ["GET", "POST"]
    }
  });

  app.use(cors());

  io.on("connection", (socket) => {
    socket.on("posicao-atual", (data) => {
      console.log('Dados recebidos completos:', JSON.stringify(data, null, 2));
      io.emit("posicao-atual", data);
    });

  socket.on("disconnect", () => {
  });
  });

  const PORT = process.env.PORT || 3001;
  console.log(`WebSocket server starting on port ${PORT}`);
  server.listen(PORT, () => {
    console.log(`WebSocket server running on port ${PORT}`);
  });