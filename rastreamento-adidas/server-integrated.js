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

// Armazenar dados por aparelho
const devices = new Map() // deviceId -> { positions: [], origem: null, destino: null, lastUpdate: timestamp }
const deviceColors = ['red', 'blue', 'green', 'purple', 'orange', 'yellow', 'pink', 'cyan']

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
        
        // Enviar dados existentes para novo cliente web
        if (devices.size > 0) {
          const allDevicesData = {
            devices: Array.from(devices.entries()).map(([id, deviceData]) => ({
              deviceId: id,
              ...deviceData
            }))
          }
          socket.emit("all-devices-data", allDevicesData)
        }
      } else if (type === "mobile") {
        mobileClients.add(socket.id)
        console.log('📱 Cliente mobile registrado:', socket.id)
      }
    })
    
    socket.on("posicao-atual", (data) => {
      const deviceId = data.deviceId || socket.id // Usar deviceId ou socket.id como fallback
      
      console.log('📍 Dados do aparelho', deviceId, 'recebidos:', {
        origem: data.origem,
        coords: data.coords,
        destino: data.destino,
        destinoTexto: data.destinoTexto,
        timestamp: data.timestamp
      })
      
      // Inicializar aparelho se não existir
      if (!devices.has(deviceId)) {
        const colorIndex = devices.size % deviceColors.length
        devices.set(deviceId, {
          positions: [],
          origem: null,
          destino: null,
          color: deviceColors[colorIndex],
          lastUpdate: Date.now(),
          name: data.deviceName || `Aparelho ${devices.size + 1}`
        })
      }
      
      const device = devices.get(deviceId)
      
      // Atualizar dados do aparelho
      if (data.origem) device.origem = { lat: data.origem[0], lng: data.origem[1] }
      if (data.destino) device.destino = { lat: data.destino[0], lng: data.destino[1] }
      if (data.coords) {
        const newPosition = { lat: data.coords[0], lng: data.coords[1], timestamp: data.timestamp }
        
        // Detectar gap de tempo (mais de 30 segundos sem dados)
        const lastPosition = device.positions[device.positions.length - 1]
        const timeGap = lastPosition ? (data.timestamp - lastPosition.timestamp) : 0
        const hasTimeGap = timeGap > 30000 // 30 segundos
        
        if (hasTimeGap && lastPosition) {
          console.log(`⚠️ Gap detectado no aparelho ${deviceId}: ${Math.round(timeGap/1000)}s`)
          // Adicionar marcador de quebra no trajeto
          newPosition.isNewSegment = true
        }
        
        device.positions.push(newPosition)
        
        // Manter apenas últimas 100 posições para performance
        if (device.positions.length > 100) {
          device.positions = device.positions.slice(-100)
        }
      }
      device.lastUpdate = Date.now()
      
      // Enviar dados de TODOS os aparelhos para clientes web
      const allDevicesData = {
        devices: Array.from(devices.entries()).map(([id, deviceData]) => ({
          deviceId: id,
          ...deviceData
        }))
      }
      
      webClients.forEach(webClientId => {
        const webSocket = io.sockets.sockets.get(webClientId)
        if (webSocket) {
          webSocket.emit("all-devices-data", allDevicesData)
        }
      })
      
      console.log('📤 Dados de', devices.size, 'aparelhos reenviados para', webClients.size, 'clientes web')
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