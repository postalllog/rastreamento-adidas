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

// Função auxiliar para broadcast para clientes web
function broadcastToWebClients(event, data) {
  webClients.forEach(webClientId => {
    const webSocket = io.sockets.sockets.get(webClientId)
    if (webSocket) webSocket.emit(event, data)
  })
}

// Função auxiliar para criar dispositivo padrão
function createDevice(deviceId, deviceName) {
  const colorIndex = devices.size % deviceColors.length
  const newDevice = {
    positions: [],
    origem: null,
    destinos: [],
    nfs: [],
    entregas: [],
    color: deviceColors[colorIndex],
    lastUpdate: Date.now(),
    name: deviceName || `Aparelho ${devices.size + 1}`
  }
  devices.set(deviceId, newDevice)
  startBackupInterval(deviceId, newDevice)
  return newDevice
}

// Função auxiliar para processar destinos
function processDestinos(destinos) {
  return destinos
    .filter(dest => dest !== null && dest !== undefined)
    .map(dest => {
      // Formato do mobile: [lat, lng, {endereco, nd}]
      if (Array.isArray(dest) && dest.length >= 3 && typeof dest[0] === 'number' && typeof dest[1] === 'number') {
        return {
          lat: dest[0],
          lng: dest[1],
          endereco: dest[2]?.endereco || null,
          nd: dest[2]?.nd || null
        }
      }
      // Formato padrão: {latitude, longitude}
      if (dest?.latitude && dest?.longitude && 
          typeof dest.latitude === 'number' && typeof dest.longitude === 'number' &&
          !isNaN(dest.latitude) && !isNaN(dest.longitude)) {
        return {
          lat: dest.latitude,
          lng: dest.longitude,
          endereco: dest.endereco || null,
          nd: dest.nd || null
        }
      }
      // Formato simples: [lat, lng]
      if (Array.isArray(dest) && dest.length >= 2 && typeof dest[0] === 'number' && typeof dest[1] === 'number') {
        return { lat: dest[0], lng: dest[1] }
      }
      console.warn('⚠️ Destino inválido ignorado:', dest)
      return null
    })
    .filter(dest => dest !== null)
}

// Função auxiliar para obter dados de todos os dispositivos
function getAllDevicesData() {
  return {
    devices: Array.from(devices.entries()).map(([id, deviceData]) => ({
      deviceId: id,
      ...deviceData,
      routeData: deviceRoutes.get(id) || null
    }))
  }
}

// Função auxiliar para atualizar NF no dispositivo
function updateNFInDevice(deviceId, nfData) {
  if (!devices.has(deviceId)) return false
  
  const device = devices.get(deviceId)
  if (!device.nfs) device.nfs = []
  
  const existingNfIndex = device.nfs.findIndex(nf => nf.nd === nfData.nd)
  
  if (existingNfIndex >= 0) {
    const oldStatus = device.nfs[existingNfIndex].status
    device.nfs[existingNfIndex] = {
      ...device.nfs[existingNfIndex],
      ...nfData,
      timestamp: nfData.timestamp || Date.now()
    }
    console.log(`✅ NF ${nfData.nd} atualizada: ${oldStatus} → ${nfData.status}`)
  } else {
    device.nfs.push({
      ...nfData,
      timestamp: nfData.timestamp || Date.now(),
      nfe: nfData.nfe || null,
      destinatario: nfData.destinatario || null,
      endereco: nfData.endereco || null
    })
    console.log(`📦 Nova NF ${nfData.nd} adicionada: ${nfData.status}`)
  }
  
  return true
}

// Função para criar log de backup
function createBackupLog(deviceId, device, isOffline = false) {
  if (device.positions.length === 0) return
  
  const lastPosition = device.positions[device.positions.length - 1]
  const logEntry = {
    timestamp: Date.now(),
    position: { lat: lastPosition.lat, lng: lastPosition.lng },
    googleMapsLink: generateGoogleMapsLink(lastPosition.lat, lastPosition.lng, device.name),
    isOffline,
    deviceName: device.name
  }
  
  if (!backupLogs.has(deviceId)) backupLogs.set(deviceId, [])
  
  const logs = backupLogs.get(deviceId)
  logs.push(logEntry)
  if (logs.length > 50) logs.splice(0, logs.length - 50) // Mais eficiente que slice
  
  console.log(`📋 Backup log criado para ${device.name}:`, {
    isOffline: isOffline ? '🔴 OFFLINE' : '🟢 ONLINE',
    link: logEntry.googleMapsLink
  })
  
  // Enviar logs para clientes web
  broadcastToWebClients("backup-logs", { deviceId, logs })
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

    // Listener para dados de rota
    socket.on("route-data", (routeData) => {
      console.log('📍 ===== ROUTE-DATA RECEBIDO =====')
      
      const deviceId = routeData.deviceId || socket.id
      deviceRoutes.set(deviceId, routeData)
      
      // Criar dispositivo se não existir
      if (!devices.has(deviceId)) {
        createDevice(deviceId)
        console.log(`📱 Dispositivo criado via route-data`)
      }
      
      const device = devices.get(deviceId)
      
      // Processar destinos da rota
      if (routeData.destinos) {
        device.destinos = processDestinos(routeData.destinos)
        console.log(`✅ ${device.destinos.length} destinos aplicados ao dispositivo ${device.name}`)
      }
      
      // Processar NFs da rota
      if (routeData.nfs?.length) {
        device.nfs = routeData.nfs.map(nf => ({
          nd: nf.nd,
          nfe: nf.nfe || null,
          status: nf.status || 'pending',
          destinatario: nf.destinatario || null,
          endereco: nf.endereco || null,
          timestamp: nf.timestamp || Date.now()
        }))
        console.log(`✅ ${device.nfs.length} NFs aplicadas ao dispositivo ${device.name}`)
      }
      
      // Enviar dados atualizados para clientes web
      const allDevicesData = getAllDevicesData()
      broadcastToWebClients("all-devices-data", allDevicesData)
      broadcastToWebClients("route-received", { deviceId, routeData })
      
      console.log('📤 Dados de rota enviados para', webClients.size, 'clientes web')
    })

    // Listener para início de rastreamento
    socket.on("tracking-started", (data) => {
      console.log('🚀 ===== TRACKING-STARTED RECEBIDO =====')
      
      const deviceId = data.deviceId || socket.id
      
      // Criar dispositivo se não existir
      if (!devices.has(deviceId)) {
        createDevice(deviceId, data.deviceName)
        console.log(`📱 Dispositivo criado via tracking-started`)
      }
      
      const device = devices.get(deviceId)
      
      // Processar dados de rota se existirem
      if (data.routeData?.destinos) {
        device.destinos = processDestinos(data.routeData.destinos)
        console.log(`✅ ${device.destinos.length} destinos aplicados via tracking-started`)
        
        // Processar NFs se estiverem presentes
        if (data.routeData.nfs?.length) {
          device.nfs = data.routeData.nfs.map(nf => ({
            nd: nf.nd,
            nfe: nf.nfe || null,
            status: nf.status || 'pending',
            destinatario: nf.destinatario || null,
            endereco: nf.endereco || null,
            timestamp: nf.timestamp || Date.now()
          }))
          console.log(`✅ ${device.nfs.length} NFs aplicadas via tracking-started`)
        }
        
        // Enviar dados atualizados para clientes web
        broadcastToWebClients("all-devices-data", getAllDevicesData())
      }
      
      // Enviar status de rastreamento
      broadcastToWebClients("tracking-status", { 
        status: 'started', 
        data,
        timestamp: Date.now()
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

    // Listener para mudanças de status de NF
    socket.on("nf-status-changed", (data) => {
      console.log('📦 ===== NF-STATUS-CHANGED RECEBIDO =====')
      
      const deviceId = data.deviceId || socket.id
      const updated = updateNFInDevice(deviceId, {
        nd: data.nd,
        status: data.status,
        statusCode: data.statusCode || null
      })
      
      if (updated) {
        // Verificar se é entrega para roteamento inteligente
        const isDelivered = ['delivered', 'entregue', 'concluido'].includes(data.status)
        if (isDelivered) {
          console.log(`🎯 NF ${data.nd} marcada como entregue - sistema de roteamento será atualizado`)
        }
        
        // Enviar dados atualizados para clientes web
        const allDevicesData = getAllDevicesData()
        broadcastToWebClients("all-devices-data", allDevicesData)
        broadcastToWebClients("nf-status-update", {
          deviceId,
          nfData: data,
          timestamp: Date.now()
        })
        
        // Evento para recálculo de rotas se NF foi entregue
        if (isDelivered) {
          broadcastToWebClients("route-recalculation-needed", {
            deviceId,
            deliveredND: data.nd,
            timestamp: Date.now()
          })
          console.log(`🗺️ Solicitando recálculo de rotas para ${deviceId} (NF ${data.nd} entregue)`)
        }
        
        console.log('📤 Status de NF enviado para', webClients.size, 'clientes web')
      }
    })

    // Novo listener para baixa de NF (evento específico do mobile)
    socket.on("nf-baixa", (data) => {
      console.log('📋 ===== NF-BAIXA RECEBIDO =====')
      
      const deviceId = data.deviceId || socket.id
      const updated = updateNFInDevice(deviceId, {
        nd: data.nd,
        status: data.status,
        statusCode: data.statusCode,
        baixaLocation: data.location,
        baixaTimestamp: data.timestamp || Date.now()
      })
      
      if (updated) {
        console.log(`📋 Baixa registrada para NF ${data.nd}: código ${data.statusCode} (${data.status})`)
        
        // Enviar confirmação para mobile
        socket.emit("nf-baixa-confirmed", {
          nd: data.nd,
          statusCode: data.statusCode,
          status: data.status,
          timestamp: Date.now(),
          success: true
        })
        
        // Enviar para clientes web
        broadcastToWebClients("nf-baixa-notification", {
          deviceId,
          baixaData: data,
          timestamp: Date.now()
        })
        
        console.log(`📤 Baixa da NF ${data.nd} processada e enviada para clientes web`)
      }
    })

    // ✅ NOVO: Listener específico para baixa realizada (sinal direto do mobile para o painel)
    socket.on("painel-baixa-realizada", (data) => {
      console.log('🚨 ===== PAINEL-BAIXA-REALIZADA RECEBIDO =====');
      console.log('🚨 SINAL DIRETO PARA O PAINEL:', JSON.stringify(data, null, 2));
      
      const deviceId = data.deviceId || socket.id;
      
      // Processar baixa imediatamente
      if (devices.has(deviceId)) {
        const device = devices.get(deviceId);
        if (!device.nfs) device.nfs = [];
        
        // Atualizar NF com informações da baixa
        const nfIndex = device.nfs.findIndex(nf => nf.nd === data.nd);
        if (nfIndex >= 0) {
          device.nfs[nfIndex] = {
            ...device.nfs[nfIndex],
            status: data.status,
            statusCode: data.statusCode,
            baixaLocation: data.location,
            baixaTimestamp: data.timestamp || Date.now(),
            baixaMessage: data.message
          };
          console.log(`🚨 BAIXA IMEDIATA registrada para NF ${data.nd}: ${data.message}`);
        }
      }
      
      // Enviar atualização imediata para TODOS os clientes web
      webClients.forEach(webClientId => {
        const webSocket = io.sockets.sockets.get(webClientId);
        if (webSocket) {
          // Evento específico para atualização do painel
          webSocket.emit("painel-atualizacao-imediata", {
            type: "baixa-realizada",
            deviceId,
            nd: data.nd,
            status: data.status,
            statusCode: data.statusCode,
            location: data.location,
            message: data.message,
            timestamp: data.timestamp,
            deviceName: data.deviceName
          });
          
          // Enviar também dados atualizados completos
          const allDevicesData = {
            devices: Array.from(devices.entries()).map(([id, deviceData]) => ({
              deviceId: id,
              ...deviceData,
              routeData: deviceRoutes.get(id) || null
            }))
          };
          webSocket.emit("all-devices-data", allDevicesData);
        }
      });
      
      console.log(`🚨 ATUALIZAÇÃO IMEDIATA enviada para ${webClients.size} clientes web - NF ${data.nd} baixada!`);
    })

    // Listener para atualizações de entrega
    socket.on("delivery-status-update", (data) => {
      console.log('🚚 ===== DELIVERY-STATUS-UPDATE RECEBIDO =====')
      
      const deviceId = data.deviceId || socket.id
      
      if (devices.has(deviceId)) {
        const device = devices.get(deviceId)
        if (!device.entregas) device.entregas = []
        
        // Registrar entrega
        device.entregas.push({
          nd: data.nd,
          status: data.status,
          location: data.location,
          timestamp: data.timestamp || Date.now(),
          source: data.source || 'mobile'
        })
        
        // Atualizar status da NF correspondente
        updateNFInDevice(deviceId, {
          nd: data.nd,
          status: data.status,
          deliveryLocation: data.location,
          deliveryTimestamp: data.timestamp || Date.now(),
          deliverySource: data.source || 'mobile'
        })
        
        console.log(`🚚 Entrega registrada para ND ${data.nd}: ${data.status} (fonte: ${data.source || 'mobile'})`)
      }
      
      // Enviar para clientes web
      broadcastToWebClients("delivery-notification", {
        deviceId,
        deliveryData: data,
        timestamp: Date.now()
      })
      
      console.log('📤 Notificação de entrega enviada para', webClients.size, 'clientes web')
    })

    // Listener para progresso da rota
    socket.on("route-progress-update", (data) => {
      console.log('🗺️ ===== ROUTE-PROGRESS-UPDATE RECEBIDO =====')
      
      broadcastToWebClients("route-update", data)
      console.log('📤 Progresso da rota enviado para', webClients.size, 'clientes web')
    })
    
    socket.on("posicao-atual", (data) => {
      const deviceId = data.deviceId || socket.id // Usar deviceId ou socket.id como fallback
      
      console.log('📍 ===== POSICAO-ATUAL RECEBIDA =====');
      console.log('DeviceId:', deviceId);
      console.log('Dados completos:', JSON.stringify(data, null, 2));
      
      // Inicializar aparelho se não existir
      if (!devices.has(deviceId)) {
        createDevice(deviceId, data.deviceName || `Aparelho ${devices.size + 1}`)
      }
      
      const device = devices.get(deviceId)
      
      // Atualizar origem apenas uma vez (quando receber pela primeira vez)
      if (data.origem && !device.origem) {
        device.origem = { lat: data.origem[0], lng: data.origem[1] }
        console.log(`🏁 Origem definida para ${device.name}:`, device.origem)
      }
      
      // Processar destinos apenas se não existirem ainda (uma única vez)
      if (!device.destinos || device.destinos.length === 0) {
        // Verificar routeData primeiro
        const routeData = deviceRoutes.get(deviceId);
        console.log(`🔍 RouteData para ${deviceId}:`, routeData);
        
        if (routeData && routeData.destinos && routeData.destinos.length > 0) {
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
              return null;
            })
            .filter(dest => dest !== null);
          console.log(`✅ ${device.destinos.length} destinos aplicados dos routeData para ${device.name}`);
        }
        
        // Se não há routeData, tentar dos dados recebidos
        else if (data.destinos && Array.isArray(data.destinos)) {
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
      
      // Log específico para NFs
      allDevicesData.devices.forEach(device => {
        if (device.nfs && device.nfs.length > 0) {
          console.log(`📦 NFs sendo enviadas para web - Dispositivo ${device.name}:`);
          device.nfs.forEach((nf, index) => {
            console.log(`  ${index + 1}. ND: ${nf.nd}, Status: ${nf.status}, NFe: ${nf.nfe}`);
          });
        }
      });
      
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
                webSocket.emit('device-disconnected')
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