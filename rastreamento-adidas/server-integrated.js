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

const devices = new Map() 
const deviceColors = ['red', 'blue', 'green', 'purple', 'orange', 'yellow', 'pink', 'cyan']

const backupIntervals = new Map() 
const backupLogs = new Map() 

function generateGoogleMapsLink(lat, lng, deviceName) {
  return `https://www.google.com/maps?q=${lat},${lng}&t=m&z=15&marker=${encodeURIComponent(deviceName)}`
}

// Função para criar log de backup
function createBackupLog(deviceId, device, isOffline = false) {
  if (device.positions.length === 0) return
  
  const lastPosition = device.positions[device.positions.length - 1]
  const googleMapsLink = generateGoogleMapsLink(
    lastPosition.lat, 
    lastPosition.lng, 
    device.name
  )
  
  if (!backupLogs.has(deviceId)) {
    backupLogs.set(deviceId, [])
  }
  
  const logEntry = {
    timestamp: Date.now(),
    position: { lat: lastPosition.lat, lng: lastPosition.lng },
    googleMapsLink,
    isOffline,
    deviceName: device.name
  }
  
  backupLogs.get(deviceId).push(logEntry)
  
  // Manter apenas últimos 50 logs
  if (backupLogs.get(deviceId).length > 50) {
    backupLogs.get(deviceId) = backupLogs.get(deviceId).slice(-50)
  }
  
  console.log(`📍 Backup log criado para ${device.name}:`, {
    isOffline: isOffline ? '🔴 OFFLINE' : '🟢 ONLINE',
    link: googleMapsLink
  })
  
  // Enviar logs para clientes web
  const allBackupLogs = {
    deviceId,
    logs: backupLogs.get(deviceId)
  }
  
  webClients.forEach(webClientId => {
    const webSocket = io.sockets.sockets.get(webClientId)
    if (webSocket) {
      webSocket.emit("backup-logs", allBackupLogs)
    }
  })
}

// Função para iniciar backup automático
function startBackupInterval(deviceId, device) {
  // Limpar intervalo anterior se existir
  if (backupIntervals.has(deviceId)) {
    clearInterval(backupIntervals.get(deviceId))
  }
  
  // Criar backup a cada 10 minutos (600000ms)
  const intervalId = setInterval(() => {
    createBackupLog(deviceId, device, false)
  }, 600000) // 10 minutos
  
  backupIntervals.set(deviceId, intervalId)
  console.log(`⏰ Backup automático iniciado para ${device.name} (10min)`)
}

// Função para detectar dispositivo offline e criar backups mais frequentes
function handleOfflineDevice(deviceId, device) {
  console.log(`🔴 Dispositivo ${device.name} detectado como offline`)
  
  // Limpar intervalo normal
  if (backupIntervals.has(deviceId)) {
    clearInterval(backupIntervals.get(deviceId))
  }
  
  // Criar backup offline a cada 5 minutos (300000ms)
  const offlineIntervalId = setInterval(() => {
    createBackupLog(deviceId, device, true)
  }, 300000) // 5 minutos
  
  backupIntervals.set(deviceId, offlineIntervalId)
  console.log(`⚠️ Backup offline iniciado para ${device.name} (5min)`)
}

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
        
        // Notificar clientes web sobre nova conexão de dispositivo
        webClients.forEach(webClientId => {
          const webSocket = io.sockets.sockets.get(webClientId)
          if (webSocket) {
            webSocket.emit('device-connected')
          }
        })
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
        const newDevice = {
          positions: [],
          origem: null,
          destino: null,
          color: deviceColors[colorIndex],
          lastUpdate: Date.now(),
          name: data.deviceName || `Aparelho ${devices.size + 1}`
        }
        devices.set(deviceId, newDevice)
        
        // Iniciar sistema de backup para novo dispositivo
        startBackupInterval(deviceId, newDevice)
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
      
      const now = Date.now()
      const timeSinceLastUpdate = now - device.lastUpdate
      device.lastUpdate = now
      
      // Se ficou mais de 15 minutos offline, reiniciar backup normal
      if (timeSinceLastUpdate > 900000) { // 15 minutos
        console.log(`🟢 Dispositivo ${device.name} voltou online após ${Math.round(timeSinceLastUpdate/60000)}min`)
        startBackupInterval(deviceId, device)
      }
      
      // Enviar dados de TODOS os aparelhos para clientes web
      const allDevicesData = {
        devices: Array.from(devices.entries()).map(([id, deviceData]) => ({
          deviceId: id,
          ...deviceData
        }))
      }
      
      console.log('📤 Enviando para web:', JSON.stringify(allDevicesData, null, 2));
      
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
      
      // Verificar se é um cliente mobile desconectando
      const wasMobileClient = mobileClients.has(socket.id)
      
      webClients.delete(socket.id)
      mobileClients.delete(socket.id)
      
      // Se for um cliente mobile, notificar clientes web e iniciar monitoramento offline
      if (wasMobileClient) {
        // Notificar clientes web sobre desconexão de dispositivo
        webClients.forEach(webClientId => {
          const webSocket = io.sockets.sockets.get(webClientId)
          if (webSocket) {
            webSocket.emit('device-disconnected')
          }
        })
        
        devices.forEach((device, deviceId) => {
          setTimeout(() => {
            // Verificar se ainda está offline após 2 minutos
            const timeSinceLastUpdate = Date.now() - device.lastUpdate
            if (timeSinceLastUpdate > 120000) { // 2 minutos
              handleOfflineDevice(deviceId, device)
            }
          }, 120000) // 2 minutos
        })
      }
    })
  })

  server.listen(port, (err) => {
    if (err) throw err
    console.log(`🚀 Next.js + Socket.IO rodando em http://${hostname}:${port}`)
  })
})