"use client"

import { useEffect, useState, useRef, useCallback } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { io, Socket } from "socket.io-client";

export interface Location {
  lat: number;
  lng: number;
}

interface Device {
  deviceId: string;
  positions: Array<{ lat: number; lng: number; timestamp: number; isNewSegment?: boolean }>;
  origem: Location | null;
  destino: Location | null;
  color: string;
  name: string;
  lastUpdate: number;
  routeData?: any;
}

interface TrackingMapProps {
  socketUrl?: string;
  center?: Location;
}

// Criar ícones uma única vez fora do componente
const icons = {
  origem: new L.Icon({
    iconUrl: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="%23008000" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2z"/></svg>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  }),
  destino: new L.Icon({
    iconUrl: '/marker-icon.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  }),
  posicaoAtual: new L.Icon({
    iconUrl: '/caminhao-icon.png',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  }),
  waypoint: new L.Icon({
    iconUrl: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="%23FF9800" stroke="%23ffffff" stroke-width="2"/><text x="12" y="16" text-anchor="middle" font-size="12" fill="white">{index}</text></svg>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
};

export function TrackingMap({ socketUrl = 'ws://localhost:3000', center = { lat: -23.5505, lng: -46.6333 } }: TrackingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [trackingStatus, setTrackingStatus] = useState<string>('');
  
  // Refs para elementos do mapa
  const markersRef = useRef<Map<string, L.Marker[]>>(new Map());
  const polylinesRef = useRef<Map<string, L.Polyline[]>>(new Map());
  const routePolylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const waypointMarkersRef = useRef<Map<string, L.Marker[]>>(new Map());

  // Controle de estado anterior por aparelho
  const lastStateRef = useRef<Map<string, any>>(new Map());

  // Função para buscar rota entre dois pontos (para gaps)
  const fetchGapRoute = useCallback(async (start: Location, end: Location): Promise<Location[]> => {
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`
      );
      const data = await response.json();
      if (data.routes?.[0]?.geometry?.coordinates) {
        return data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => ({ lat, lng })
        );
      }
    } catch (error) {
      console.error('Erro ao buscar rota do gap:', error);
    }
    return [start, end];
  }, []);

  // Função para criar segmentos com rotas inteligentes
  const createSegments = useCallback(async (positions: Device['positions']) => {
    const segments: Location[][] = [];
    let currentSegment: Location[] = [];
    
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      
      if (pos.isNewSegment && currentSegment.length > 0) {
        segments.push([...currentSegment]);
        
        const lastPoint = currentSegment[currentSegment.length - 1];
        const currentPoint = { lat: pos.lat, lng: pos.lng };
        
        const gapRoute = await fetchGapRoute(lastPoint, currentPoint);
        if (gapRoute.length > 2) {
          segments.push(gapRoute);
        }
        
        currentSegment = [currentPoint];
      } else {
        currentSegment.push({ lat: pos.lat, lng: pos.lng });
      }
    }
    
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }
    
    return segments;
  }, [fetchGapRoute]);

  // Função para buscar rota OSRM
  const fetchRoute = useCallback(async (origem: Location, destino: Location, deviceId: string) => {
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`
      );
      const data = await response.json();
      if (data.routes?.[0]?.geometry?.coordinates) {
        const coords = data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng]
        );
        
        // Remover rota anterior se existir
        const existingRoute = routePolylinesRef.current.get(deviceId);
        if (existingRoute && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(existingRoute);
        }
        
        // Adicionar nova rota
        if (mapInstanceRef.current) {
          const routePolyline = L.polyline(coords, {
            color: 'blue',
            weight: 4,
            opacity: 0.7
          }).addTo(mapInstanceRef.current);
          routePolylinesRef.current.set(deviceId, routePolyline);
        }
      }
    } catch (error) {
      console.error('Erro ao buscar rota:', error);
    }
  }, []);

  // Inicializar WebSocket
  useEffect(() => {
    if (!socketUrl) return;

    const socket = io(socketUrl, { 
      transports: ["websocket", "polling"],
      timeout: 10000 
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log('🌐 Conectado ao servidor WebSocket');
      setConnectionStatus('connected');
      // Identificar como cliente web
      socket.emit('client-type', 'web');
    });

    socket.on("disconnect", () => {
      console.log('❌ Desconectado do servidor WebSocket');
      setConnectionStatus('disconnected');
      setTrackingStatus('');
    });

    socket.on("connect_error", (error) => {
      console.error('❌ Erro de conexão WebSocket:', error);
      setConnectionStatus('disconnected');
    });

    // Listener para dados de todos os dispositivos
    socket.on("all-devices-data", (data) => {
      console.log('📱 Dados de dispositivos recebidos:', data);
      if (data.devices && Array.isArray(data.devices)) {
        setDevices(data.devices);
      }
    });

    // Listener para dados de rota
    socket.on("route-received", (data) => {
      console.log('📍 Dados de rota recebidos:', data);
      // Atualizar dispositivo com dados de rota
      setDevices(prevDevices => 
        prevDevices.map(device => 
          device.deviceId === data.deviceId 
            ? { ...device, routeData: data.routeData }
            : device
        )
      );
    });

    // Listener para status de rastreamento
    socket.on("tracking-status", (data) => {
      console.log('🚀 Status de rastreamento:', data);
      if (data.status === 'started') {
        setTrackingStatus(`Rastreamento iniciado: ${data.data.deviceName}`);
      } else if (data.status === 'stopped') {
        setTrackingStatus(`Rastreamento encerrado: ${data.data.deviceName}`);
      }
    });

    // Listener para conexão de dispositivo
    socket.on("device-connected", () => {
      console.log('📱 Novo dispositivo conectado');
      setTrackingStatus('Novo dispositivo conectado');
    });

    // Listener para desconexão de dispositivo
    socket.on("device-disconnected", () => {
      console.log('📱 Dispositivo desconectado');
      setTrackingStatus('Dispositivo desconectado');
      setDevices([]);
    });

    // Listener para logs de desconexão
    socket.on("device-disconnection-log", (log) => {
      console.log('📋 Log de desconexão:', log);
      setTrackingStatus(`${log.deviceName} desconectado em ${new Date(log.timestamp).toLocaleTimeString()}`);
    });

    // Listener para backup logs
    socket.on("backup-logs", (data) => {
      console.log('📋 Backup logs:', data);
    });

    setConnectionStatus('connecting');

    return () => {
      socket.disconnect();
    };
  }, [socketUrl]);

  // Inicializar o mapa
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const initMap = () => {
      try {
        const map = L.map(mapRef.current!).setView([center.lat, center.lng], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        mapInstanceRef.current = map;
        setIsLoaded(true);
      } catch (error) {
        console.error('Erro ao inicializar o mapa:', error);
      }
    };

    initMap();
    
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [center]);

  // Renderizar todos os aparelhos
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded) return;

    console.log('🗺️ Renderizando aparelhos:', devices.length);

    // Limpar elementos anteriores
    markersRef.current.forEach(markers => {
      markers.forEach(marker => mapInstanceRef.current?.removeLayer(marker));
    });
    polylinesRef.current.forEach(polylines => {
      polylines.forEach(polyline => mapInstanceRef.current?.removeLayer(polyline));
    });
    waypointMarkersRef.current.forEach(markers => {
      markers.forEach(marker => mapInstanceRef.current?.removeLayer(marker));
    });
    
    markersRef.current.clear();
    polylinesRef.current.clear();
    waypointMarkersRef.current.clear();

    // Renderizar cada aparelho
    devices.forEach(device => {
      const deviceMarkers: L.Marker[] = [];
      const devicePolylines: L.Polyline[] = [];
      const waypointMarkers: L.Marker[] = [];

      // Renderizar waypoints da rota se existirem
      if (device.routeData?.destinos) {
        device.routeData.destinos.forEach((destino: any, index: number) => {
          if (destino.latitude && destino.longitude) {
            const waypointIcon = new L.Icon({
              iconUrl: `data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23FF9800" stroke="%23ffffff" stroke-width="2"/><text x="12" y="16" text-anchor="middle" font-size="10" fill="white">${index + 1}</text></svg>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            });

            const waypointMarker = L.marker([destino.latitude, destino.longitude], { icon: waypointIcon })
              .bindPopup(`
                <strong>${device.name} - Destino ${index + 1}</strong><br>
                ND: ${destino.nd}<br>
                Endereço: ${destino.endereco || 'N/A'}
              `)
              .addTo(mapInstanceRef.current!);
            waypointMarkers.push(waypointMarker);
          }
        });
      }

      // Marcador de origem
      if (device.origem) {
        const origemMarker = L.marker([device.origem.lat, device.origem.lng], { icon: icons.origem })
          .bindPopup(`${device.name} - Origem`)
          .addTo(mapInstanceRef.current!);
        deviceMarkers.push(origemMarker);
      }

      // Marcador de destino
      if (device.destino) {
        const destinoMarker = L.marker([device.destino.lat, device.destino.lng], { icon: icons.destino })
          .bindPopup(`${device.name} - Destino`)
          .addTo(mapInstanceRef.current!);
        deviceMarkers.push(destinoMarker);
      }

      // Buscar e desenhar rota planejada se origem e destino existem
      if (device.origem && device.destino) {
        const routeKey = `${device.origem.lat}-${device.origem.lng}-${device.destino.lat}-${device.destino.lng}`;
        const lastRouteKey = lastStateRef.current.get(device.deviceId)?.routeKey;
        
        if (routeKey !== lastRouteKey) {
          fetchRoute(device.origem, device.destino, device.deviceId);
          if (!lastStateRef.current.has(device.deviceId)) {
            lastStateRef.current.set(device.deviceId, {});
          }
          lastStateRef.current.get(device.deviceId).routeKey = routeKey;
        }
      }

      // Marcador de posição atual
      if (device.positions.length > 0) {
        const lastPos = device.positions[device.positions.length - 1];
        const currentMarker = L.marker([lastPos.lat, lastPos.lng], { icon: icons.posicaoAtual })
          .bindPopup(`
            <strong>${device.name} - Posição Atual</strong><br>
            Última atualização: ${new Date(lastPos.timestamp).toLocaleTimeString()}<br>
            Coordenadas: ${lastPos.lat.toFixed(6)}, ${lastPos.lng.toFixed(6)}
          `)
          .addTo(mapInstanceRef.current!);
        deviceMarkers.push(currentMarker);

        if(mapInstanceRef.current){
          mapInstanceRef.current.flyTo([lastPos.lat, lastPos.lng], 15, {
            animate: true,
            duration: 1.2
          });
        }
      }

      // Criar trajeto percorrido
      if (device.positions.length > 1) {
        const firstPos = device.positions[0];
        const lastPos = device.positions[device.positions.length - 1];
        const hasMoved = firstPos.lat !== lastPos.lat || firstPos.lng !== lastPos.lng;
        
        if (hasMoved) {
          createSegments(device.positions).then(segments => {
            segments.forEach((segment) => {
              if (segment.length > 1) {
                const polyline = L.polyline(segment.map(p => [p.lat, p.lng]), {
                  color: device.color,
                  weight: 3,
                  dashArray: '5, 10',
                  opacity: 0.8
                }).addTo(mapInstanceRef.current!);
                devicePolylines.push(polyline);
              }
            });
            polylinesRef.current.set(device.deviceId, devicePolylines);
          });
        }
      }

      markersRef.current.set(device.deviceId, deviceMarkers);
      waypointMarkersRef.current.set(device.deviceId, waypointMarkers);
      if (device.positions.length <= 1) {
        polylinesRef.current.set(device.deviceId, devicePolylines);
      }
    });

    // Ajustar visualização para incluir todos os marcadores
    if (devices.length > 0 && devices.some(d => d.positions.length > 0)) {
      const bounds = L.latLngBounds([]);
      
      devices.forEach(device => {
        if (device.positions.length > 0) {
          device.positions.forEach(pos => {
            bounds.extend([pos.lat, pos.lng]);
          });
        }
        if (device.origem) bounds.extend([device.origem.lat, device.origem.lng]);
        if (device.destino) bounds.extend([device.destino.lat, device.destino.lng]);
        
        // Incluir waypoints da rota
        if (device.routeData?.destinos) {
          device.routeData.destinos.forEach((destino: any) => {
            if (destino.latitude && destino.longitude) {
              bounds.extend([destino.latitude, destino.longitude]);
            }
          });
        }
      });
      
      if (bounds.isValid()) {
        mapInstanceRef.current?.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  }, [devices, isLoaded, createSegments, fetchRoute]);

  // Status da conexão
  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#4CAF50';
      case 'connecting': return '#FF9800';
      case 'disconnected': return '#f44336';
      default: return '#757575';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Conectado';
      case 'connecting': return 'Conectando...';
      case 'disconnected': return 'Desconectado';
      default: return 'Desconhecido';
    }
  };

  return (
    <div style={{ height: '100vh', width: '100%', position: 'relative' }}>
      {/* DEBUG: Painel de debug */}
      <div style={{ 
        position: 'absolute', 
        bottom: '10px', 
        right: '10px',
        zIndex: 1000,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '10px',
        borderRadius: '6px',
        fontSize: '12px',
        maxWidth: '300px'
      }}>
        <div><strong>DEBUG TrackingMap:</strong></div>
        <div>Conexão: {connectionStatus}</div>
        <div>Dispositivos: {devices.length}</div>
        <div>Mapa carregado: {isLoaded ? 'Sim' : 'Não'}</div>
        {devices.map((device, i) => (
          <div key={i}>
            Dispositivo {i+1}: {device.name} ({device.positions.length} posições)
          </div>
        ))}
      </div>

      {/* Status da conexão */}
      <div style={{ 
        position: 'absolute', 
        top: '10px', 
        right: '10px',
        zIndex: 1000,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '8px 12px',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        fontSize: '14px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div 
            style={{ 
              width: '12px', 
              height: '12px', 
              borderRadius: '50%',
              backgroundColor: getConnectionStatusColor()
            }}
          />
          <span>{getConnectionStatusText()}</span>
        </div>
        {trackingStatus && (
          <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
            {trackingStatus}
          </div>
        )}
      </div>

      {/* Informações dos dispositivos */}
      {devices.length > 0 && (
        <div style={{ 
          position: 'absolute', 
          top: '10px', 
          left: '10px',
          zIndex: 1000,
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          padding: '12px',
          borderRadius: '6px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          fontSize: '14px',
          maxWidth: '300px'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
            Dispositivos Ativos ({devices.length})
          </div>
          {devices.map(device => (
            <div key={device.deviceId} style={{ marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div 
                  style={{ 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%',
                    backgroundColor: device.color
                  }}
                />
                <span style={{ fontWeight: '500' }}>{device.name}</span>
              </div>
              <div style={{ fontSize: '12px', color: '#666', marginLeft: '14px' }}>
                Posições: {device.positions.length}
                {device.routeData && (
                  <>
                    <br />Rota: {device.routeData.rota || 'N/A'}
                    <br />Destinos: {device.routeData.destinos?.length || 0}
                  </>
                )}
                {device.positions.length > 0 && (
                  <>
                    <br />Última atualização: {new Date(device.lastUpdate).toLocaleTimeString()}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legenda */}
      <div style={{ 
        position: 'absolute', 
        bottom: '10px', 
        left: '10px',
        zIndex: 1000,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '8px',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        fontSize: '12px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Legenda</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#008000' }} />
          <span>Origem</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#FF0000' }} />
          <span>Destino</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#0066CC' }} />
          <span>Posição Atual</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#FF9800' }} />
          <span>Waypoints</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '2px', backgroundColor: '#blue', borderStyle: 'dashed' }} />
          <span>Rota Planejada</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '2px', backgroundColor: 'red', borderStyle: 'dashed' }} />
          <span>Trajeto Percorrido</span>
        </div>
      </div>

      {/* Mapa */}
      <div 
        ref={mapRef} 
        style={{ height: '100%', width: '100%' }}
      />
      
      {!isLoaded && (
        <div style={{ 
          position: 'absolute', 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          zIndex: 1000,
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          padding: '20px 30px',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: '500'
        }}>
          Carregando mapa...
        </div>
      )}

      {connectionStatus === 'disconnected' && (
        <div style={{ 
          position: 'absolute', 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          zIndex: 1000,
          backgroundColor: 'rgba(244, 67, 54, 0.9)',
          color: 'white',
          padding: '20px 30px',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: '500',
          textAlign: 'center'
        }}>
          Desconectado do servidor
          <br />
          <small style={{ fontSize: '14px' }}>Tentando reconectar...</small>
        </div>
      )}
    </div>
  );
}