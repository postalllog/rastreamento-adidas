import { Server } from 'socket.io'

const webClients = new Set();
const mobileClients = new Set();

export async function GET(request) {
  if (global.io) {
    console.log('Socket.IO já está rodando')
    return new Response('Socket.IO já está ativo', { status: 200 })
  }

  console.log('Inicializando Socket.IO...')
  
  // Criar servidor HTTP para Socket.IO
  const { createServer } = await import('http')
  const server = createServer()
  
  global.io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  })

  global.io.on('connection', (socket) => {
    console.log('🔗 Cliente conectado:', socket.id);
    
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
      
      webClients.forEach(webClientId => {
        const webSocket = global.io.sockets.sockets.get(webClientId);
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

  const PORT = 3001;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Socket.IO rodando na porta ${PORT}`);
  });

  return new Response('Socket.IO inicializado', { status: 200 })
}