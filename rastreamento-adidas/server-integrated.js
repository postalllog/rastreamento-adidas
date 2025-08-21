const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { Server } = require('socket.io')

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = process.env.PORT || 80

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

const webClients = new Set()
const mobileClients = new Set()

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error occurred handling', req.url, err)
      res.statusCode = 500
      res.end('internal server error')
    }
  })

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  })

  io.on('connection', (socket) => {
    console.log('🔗 Cliente conectado:', socket.id)
    
    socket.on("client-type", (type) => {
      if (type === "web") {
        webClients.add(socket.id)
        console.log('🌐 Cliente web registrado:', socket.id)
      } else if (type === "mobile") {
        mobileClients.add(socket.id)
        console.log('📱 Cliente mobile registrado:', socket.id)
      }
    })
    
    socket.on("posicao-atual", (data) => {
      console.log('📍 Dados do mobile recebidos:', {
        origem: data.origem,
        coords: data.coords,
        destino: data.destino,
        destinoTexto: data.destinoTexto,
        timestamp: data.timestamp
      })
      
      webClients.forEach(webClientId => {
        const webSocket = io.sockets.sockets.get(webClientId)
        if (webSocket) {
          webSocket.emit("posicao-atual", data)
        }
      })
      
      console.log('📤 Dados reenviados para', webClients.size, 'clientes web')
    })

    socket.on("disconnect", () => {
      console.log('❌ Cliente desconectado:', socket.id)
      webClients.delete(socket.id)
      mobileClients.delete(socket.id)
    })
  })

  server.listen(port, (err) => {
    if (err) throw err
    console.log(`🚀 Next.js + Socket.IO rodando em http://${hostname}:${port}`)
  })
})