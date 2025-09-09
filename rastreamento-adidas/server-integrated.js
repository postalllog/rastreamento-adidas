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

// Armazenar dados de rota por dispositivo
const deviceRoutes = new Map()

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
  
  console.log(`📋 Backup log criado para ${device.name}:`, {
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
              ...deviceData,
              routeData: deviceRoutes.get(id) || null
            }))
          }
          socket.emit("all-devices-data", allDevicesData)
        }
      } else if (type === "mobile") {
        mobileClients.add(socket.id)
        console.log('📱 Cliente mobile registrado:', socket.id)
        

      }
    })

    // Novo listener para dados de rota
    socket.on("route-data", (routeData) => {
      console.log('📍 Dados de rota recebidos:', JSON.stringify(routeData, null, 2))
      
      const deviceId = routeData.deviceId || socket.id
      deviceRoutes.set(deviceId, routeData)
      
      // Criar dispositivo se não existir
      if (!devices.has(deviceId)) {
        const colorIndex = devices.size % deviceColors.length
        const newDevice = {
          positions: [],
          origem: null,
          destinos: [],
          color: deviceColors[colorIndex],
          lastUpdate: Date.now(),
          name: `Aparelho ${devices.size + 1}`
        }
        devices.set(deviceId, newDevice)
        startBackupInterval(deviceId, newDevice)
        console.log(`📱 Dispositivo ${newDevice.name} criado via route-data`)
      }
      
      // Extrair destinos da rota e aplicar ao dispositivo
      if (routeData.destinos) {
        const device = devices.get(deviceId)
        console.log('🎯 Aplicando destinos da rota ao dispositivo:', routeData.destinos)
        device.destinos = routeData.destinos
          .filter(dest => dest !== null && dest !== undefined)
          .map((dest, index) => {
            if (dest && dest.latitude && dest.longitude && 
                typeof dest.latitude === 'number' && typeof dest.longitude === 'number' &&
                !isNaN(dest.latitude) && !isNaN(dest.longitude)) {
              return {
                lat: dest.latitude,
                lng: dest.longitude,
                endereco: dest.endereco || null,
                nd: dest.nd || null
              }
            }
            console.warn(`⚠️ Destino inválido ignorado:`, dest);
            return null;
          })
          .filter(dest => dest !== null);
        console.log(`✅ ${device.destinos.length} destinos aplicados ao dispositivo ${device.name}`)
        
        // Reenviar dados atualizados para clientes web
        const allDevicesData = {
          devices: Array.from(devices.entries()).map(([id, deviceData]) => ({
            deviceId: id,
            ...deviceData,
            routeData: deviceRoutes.get(id) || null
          }))
        }
        
        webClients.forEach(webClientId => {
          const webSocket = io.sockets.sockets.get(webClientId)
          if (webSocket) {
            webSocket.emit("all-devices-data", allDevicesData)
          }
        })
      }
      
      // Enviar dados da rota para clientes web
      webClients.forEach(webClientId => {
        const webSocket = io.sockets.sockets.get(webClientId)
        if (webSocket) {
          webSocket.emit("route-received", {
            deviceId,
            routeData
          })
        }
      })
      
      console.log('📤 Dados de rota enviados para', webClients.size, 'clientes web')
    })

    // Listener para início de rastreamento
    socket.on("tracking-started", (data) => {
      console.log('🚀 Rastreamento iniciado:', JSON.stringify(data, null, 2))
      
      const deviceId = data.deviceId || socket.id
      
      // Criar dispositivo se não existir
      if (!devices.has(deviceId)) {
        const colorIndex = devices.size % deviceColors.length
        const newDevice = {
          positions: [],
          origem: null,
          destinos: [],
          color: deviceColors[colorIndex],
          lastUpdate: Date.now(),
          name: data.deviceName || `Aparelho ${devices.size + 1}`
        }
        devices.set(deviceId, newDevice)
        startBackupInterval(deviceId, newDevice)
        console.log(`📱 Dispositivo ${newDevice.name} criado via tracking-started`)
      }
      
      // Se há dados de rota, aplicar destinos ao dispositivo
      if (data.routeData && data.routeData.destinos) {
        const device = devices.get(deviceId)
        console.log('🎯 Aplicando destinos do tracking-started:', data.routeData.destinos)
        device.destinos = data.routeData.destinos
          .filter(dest => dest !== null && dest !== undefined)
          .map((dest, index) => {
            if (dest && dest.latitude && dest.longitude && 
                typeof dest.latitude === 'number' && typeof dest.longitude === 'number' &&
                !isNaN(dest.latitude) && !isNaN(dest.longitude)) {
              return {
                lat: dest.latitude,
                lng: dest.longitude,
                endereco: dest.endereco || null,
                nd: dest.nd || null
              }
            }
            console.warn(`⚠️ Destino inválido ignorado:`, dest);
            return null;
          })
          .filter(dest => dest !== null);
        console.log(`✅ ${device.destinos.length} destinos aplicados via tracking-started`)
        
        // Reenviar dados atualizados para clientes web
        const allDevicesData = {
          devices: Array.from(devices.entries()).map(([id, deviceData]) => ({
            deviceId: id,
            ...deviceData,
            routeData: deviceRoutes.get(id) || null
          }))
        }
        
        webClients.forEach(webClientId => {
          const webSocket = io.sockets.sockets.get(webClientId)
          if (webSocket) {
            webSocket.emit("all-devices-data", allDevicesData)
          }
        })
      }
      
      webClients.forEach(webClientId => {
        const webSocket = io.sockets.sockets.get(webClientId)
        if (webSocket) {
          webSocket.emit("tracking-status", { 
            status: 'started', 
            data,
            timestamp: Date.now()
          })
        }
      })
      
      console.log('📤 Status de rastreamento (iniciado) enviado para', webClients.size, 'clientes web')
    })

    // Listener para fim de rastreamento
    socket.on("tracking-stopped", (data) => {
      console.log('🛑 Rastreamento encerrado:', data)
      
      webClients.forEach(webClientId => {
        const webSocket = io.sockets.sockets.get(webClientId)
        if (webSocket) {
          webSocket.emit("tracking-status", { 
            status: 'stopped', 
            data,
            timestamp: Date.now()
          })
        }
      })
      
      console.log('📤 Status de rastreamento (encerrado) enviado para', webClients.size, 'clientes web')
    })
    
    socket.on("posicao-atual", (data) => {
      const deviceId = data.deviceId || socket.id // Usar deviceId ou socket.id como fallback
      
      console.log('📍 Dados do aparelho', deviceId, 'recebidos:', {
        origem: data.origem,
        coords: data.coords,
        destino: data.destino,
        destinos: data.destinos,
        destinoTexto: data.destinoTexto,
        timestamp: data.timestamp
      })
      
      // Inicializar aparelho se não existir
      if (!devices.has(deviceId)) {
        const colorIndex = devices.size % deviceColors.length
        const newDevice = {
          positions: [],
          origem: null,
          destinos: [], // Array para múltiplos destinos
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
      
      // FORÇAR destinos de teste para debug
      device.destinos = [
        { lat: -23.550520, lng: -46.633308, endereco: "Teste 1", nd: "001" },
        { lat: -23.551000, lng: -46.634000, endereco: "Teste 2", nd: "002" }
      ];
      console.log(`🎯 FORÇANDO destinos de teste para ${device.name}:`, device.destinos);
      
      // Verificar routeData também
      const routeData = deviceRoutes.get(deviceId);
      if (routeData && routeData.destinos) {
        console.log(`📍 RouteData encontrado para ${device.name}:`, routeData.destinos);
      } else {
        console.log(`⚠️ Nenhum routeData encontrado para ${device.name}`);
      }
      if (data.destinos && Array.isArray(data.destinos)) {
        console.log('🎯 Processando destinos do mobile:', data.destinos);
        device.destinos = data.destinos
          .filter(dest => dest !== null && dest !== undefined)
          .map((dest, index) => {
            console.log(`🎯 Destino ${index + 1}:`, dest);
            // Formato do mobile: [lat, lng, {endereco, nd}]
            if (Array.isArray(dest) && dest.length >= 3 && typeof dest[0] === 'number' && typeof dest[1] === 'number') {
              const processed = {
                lat: dest[0], 
                lng: dest[1],
                endereco: dest[2]?.endereco || null,
                nd: dest[2]?.nd || null
              };
              console.log(`✅ Destino ${index + 1} processado do mobile:`, processed);
              return processed;
            }
            // Formato: [lat, lng]
            else if (Array.isArray(dest) && dest.length >= 2 && typeof dest[0] === 'number' && typeof dest[1] === 'number') {
              const processed = { lat: dest[0], lng: dest[1] };
              console.log(`✅ Destino ${index + 1} processado simples:`, processed);
              return processed;
            }
            console.warn(`⚠️ Destino ${index + 1} inválido:`, dest);
            return null;
          })
          .filter(dest => dest !== null);
        console.log(`🎯 Total de ${device.destinos.length} destinos processados do mobile para ${device.name}`);
      } else {
        console.log('⚠️ Nenhum destino encontrado nos dados recebidos');
      }
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
          ...deviceData,
          routeData: deviceRoutes.get(id) || null
        }))
      }
      
      console.log('📤 Enviando para web:', JSON.stringify(allDevicesData, null, 2))
      
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
      
      // Se for um cliente mobile, criar log de desconexão imediatamente
      if (wasMobileClient) {
        devices.forEach((device, deviceId) => {
          if (device.positions.length > 0) {
            const lastPosition = device.positions[device.positions.length - 1]
            const disconnectionLog = {
              timestamp: Date.now(),
              deviceName: device.name,
              position: { lat: lastPosition.lat, lng: lastPosition.lng },
              googleMapsLink: `https://www.google.com/maps?q=${lastPosition.lat},${lastPosition.lng}&t=m&z=15`
            }
            
            console.log('🔴 Criando log de desconexão para:', device.name)
            
            // Enviar log de desconexão para clientes web
            webClients.forEach(webClientId => {
              const webSocket = io.sockets.sockets.get(webClientId)
              if (webSocket) {
                webSocket.emit('device-disconnection-log', disconnectionLog)
              }
            })
          }
          
          // Limpar intervalos de backup
          if (backupIntervals.has(deviceId)) {
            clearInterval(backupIntervals.get(deviceId))
            backupIntervals.delete(deviceId)
          }
        })
        
        // Limpar dados dos dispositivos e rotas
        devices.clear()
        deviceRoutes.clear()
        

      }
      
      webClients.delete(socket.id)
      mobileClients.delete(socket.id)
    })
  })

  server.listen(port, (err) => {
    if (err) throw err
    console.log(`🚀 Next.js + Socket.IO rodando em http://${hostname}:${port}`)
  })
})