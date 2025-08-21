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

  const webClients = new Set();
  const mobileClients = new Set();

  io.on("connection", (socket) => {
    console.log('🔗 Cliente conectado:', socket.id);
    
    // Identificar tipo de cliente
    socket.on("client-type", (type) => {
      if (type === "web") {
        webClients.add(socket.id);
        console.log('🌐 Cliente web registrado:', socket.id);
      } else if (type === "mobile") {
        mobileClients.add(socket.id);
        console.log('📱 Cliente mobile registrado:', socket.id);
      }
    });
    
    socket.on("posicao-atual", (data) => {
      console.log('📍 Dados do mobile recebidos:', {
        origem: data.origem,
        coords: data.coords,
        destino: data.destino,
        destinoTexto: data.destinoTexto,
        timestamp: data.timestamp
      });
      
      // Reenviar APENAS para clientes web
      webClients.forEach(webClientId => {
        const webSocket = io.sockets.sockets.get(webClientId);
        if (webSocket) {
          webSocket.emit("posicao-atual", data);
        }
      });
      
      console.log('📤 Dados reenviados para', webClients.size, 'clientes web');
    });

    socket.on("disconnect", () => {
      console.log('❌ Cliente desconectado:', socket.id);
      webClients.delete(socket.id);
      mobileClients.delete(socket.id);
    });
  });

  const PORT = process.env.PORT || 3001;
  console.log(`WebSocket server starting on port ${PORT}`);
  server.listen(PORT, () => {
    console.log(`WebSocket server running on port ${PORT}`);
  });