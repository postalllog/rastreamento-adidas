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
  destinos: Array<{ lat: number; lng: number; endereco?: string; nd?: string }> | null;
  nfs?: Array<{ nd: string; nfe?: string; status: string; destinatario?: string; endereco?: string; timestamp: number }>;
  entregas?: Array<{ nd: string; status: string; location?: [number, number]; timestamp: number }>;
  color: string;
  name: string;
  lastUpdate: number;
  routeData?: any;
}

interface TrackingMapProps {
  devices: Device[];
  center: Location;
}

// Criar ícones uma única vez fora do componente
const icons = {
  origem: new L.Icon({
    iconUrl: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="%23008000" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2z"/></svg>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  }),
  destino: new L.Icon({
    iconUrl: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="%23FF0000" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5z"/></svg>',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  }),
  destinoEntregue: new L.Icon({
    iconUrl: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="%2300C851" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5z"/><path fill="%23FFFFFF" d="M9 11l2 2l4-4" stroke="%23FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
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

export function TrackingMap({ devices, center }: TrackingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Refs para elementos do mapa
  const markersRef = useRef<Map<string, L.Marker[]>>(new Map());
  const polylinesRef = useRef<Map<string, L.Polyline[]>>(new Map());
  const routePolylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const waypointMarkersRef = useRef<Map<string, L.Marker[]>>(new Map());

  // Controle de estado anterior por aparelho
  const lastStateRef = useRef<Map<string, any>>(new Map());

  // Função para verificar se uma NF foi entregue
  const isNFEntregue = useCallback((device: Device, nd?: string): boolean => {
    if (!nd || !device.nfs) return false;
    const nf = device.nfs.find(nf => nf.nd === nd);
    return nf?.status === 'delivered' || nf?.status === 'entregue';
  }, []);

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
    if (!mapInstanceRef.current || !isLoaded) {
      console.log('⚠️ Mapa não inicializado ainda. mapInstance:', !!mapInstanceRef.current, 'isLoaded:', isLoaded);
      return;
    }
    
    console.log('✅ Mapa inicializado, processando dispositivos...');
    


    console.log('🗺️ Renderizando aparelhos:', devices.length);
    
    if (devices.length === 0) {
      console.log('⚠️ NENHUM DISPOSITIVO RECEBIDO!');
      return;
    }
    
    devices.forEach(device => {
      console.log(`📱 Aparelho ${device.name}:`, device);
      console.log(`🎯 Destinos para ${device.name}:`, device.destinos);
      console.log(`📍 Tipo dos destinos:`, typeof device.destinos, Array.isArray(device.destinos));
      
      if (device.destinos && device.destinos.length > 0) {
        console.log(`🎯 ${device.destinos.length} destinos encontrados:`);
        device.destinos.forEach((dest, i) => {
          console.log(`  ${i + 1}. lat: ${dest?.lat}, lng: ${dest?.lng}, endereco: ${dest?.endereco}, nd: ${dest?.nd}`);
          console.log(`      Tipo lat: ${typeof dest?.lat}, Tipo lng: ${typeof dest?.lng}`);
        });
      } else {
        console.log(`❌ NENHUM DESTINO para ${device.name}`);
      }
    });

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
          if (destino.latitude && destino.longitude && 
              typeof destino.latitude === 'number' && typeof destino.longitude === 'number' &&
              !isNaN(destino.latitude) && !isNaN(destino.longitude)) {
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
      if (device.origem && typeof device.origem.lat === 'number' && typeof device.origem.lng === 'number' &&
          !isNaN(device.origem.lat) && !isNaN(device.origem.lng)) {
        const origemMarker = L.marker([device.origem.lat, device.origem.lng], { icon: icons.origem })
          .bindPopup(`${device.name} - Origem`)
          .addTo(mapInstanceRef.current!);
        deviceMarkers.push(origemMarker);
      }

      // Marcadores de todos os destinos
      if (device.destinos && device.destinos.length > 0) {
        console.log(`📍 Renderizando ${device.destinos.length} destinos para ${device.name}`);
        device.destinos.forEach((destino, index) => {
          try {
            if (destino && typeof destino.lat === 'number' && typeof destino.lng === 'number' && 
                !isNaN(destino.lat) && !isNaN(destino.lng)) {
              
              // Verificar se esta NF foi entregue
              const foiEntregue = isNFEntregue(device, destino.nd);
              const iconToUse = foiEntregue ? icons.destinoEntregue : icons.destino;
              const statusText = foiEntregue ? '✅ ENTREGUE' : '📦 Pendente';
              
              const destinoMarker = L.marker([destino.lat, destino.lng], { icon: iconToUse })
                .bindPopup(`
                  <strong>${device.name} - Destino ${index + 1}</strong><br>
                  ${destino.endereco ? `Endereço: ${destino.endereco}<br>` : ''}
                  ${destino.nd ? `ND: ${destino.nd}<br>` : ''}
                  <strong>Status: ${statusText}</strong>
                `)
                .addTo(mapInstanceRef.current!);
              deviceMarkers.push(destinoMarker);
              console.log(`✅ Marcador de destino ${index + 1} adicionado ao mapa (${foiEntregue ? 'ENTREGUE' : 'PENDENTE'})`);
            }
          } catch (error) {
            console.error(`❌ Erro ao criar marcador de destino ${index + 1}:`, error, destino);
          }
        });
      } else {
        console.log(`⚠️ Nenhum destino encontrado para ${device.name}`);
      }

      // Buscar e desenhar rota planejada se origem e destinos existem
      if (device.origem && device.destinos && device.destinos.length > 0) {
        const firstDestino = device.destinos[0];
        const routeKey = `${device.origem.lat}-${device.origem.lng}-${firstDestino.lat}-${firstDestino.lng}`;
        const lastRouteKey = lastStateRef.current.get(device.deviceId)?.routeKey;
        
        if (routeKey !== lastRouteKey) {
          fetchRoute(device.origem, firstDestino, device.deviceId);
          if (!lastStateRef.current.has(device.deviceId)) {
            lastStateRef.current.set(device.deviceId, {});
          }
          lastStateRef.current.get(device.deviceId).routeKey = routeKey;
        }
      }

      // Marcador de posição atual
      if (device.positions.length > 0) {
        const lastPos = device.positions[device.positions.length - 1];
        if (typeof lastPos.lat === 'number' && typeof lastPos.lng === 'number' &&
            !isNaN(lastPos.lat) && !isNaN(lastPos.lng)) {
          const currentMarker = L.marker([lastPos.lat, lastPos.lng], { icon: icons.posicaoAtual })
            .bindPopup(`
              <strong>${device.name} - Posição Atual</strong><br>
              Última atualização: ${new Date(lastPos.timestamp).toLocaleTimeString()}<br>
              Coordenadas: ${lastPos.lat.toFixed(6)}, ${lastPos.lng.toFixed(6)}
            `)
            .addTo(mapInstanceRef.current!);
          deviceMarkers.push(currentMarker);
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

    // Zoom automático removido conforme solicitado
  }, [devices, isLoaded, createSegments, fetchRoute, isNFEntregue]);

  // useEffect separado para rotas entre destinos consecutivos
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded) return;

    devices.forEach(async (device) => {
      if (device.destinos && device.destinos.length > 1) {
        for (let i = 0; i < device.destinos.length - 1; i++) {
          const start = device.destinos[i];
          const end = device.destinos[i + 1];

          // Verificar se ambos os destinos foram entregues
          const startEntregue = isNFEntregue(device, start.nd);
          const endEntregue = isNFEntregue(device, end.nd);
          
          // Definir cor da rota baseado no status de entrega
          let routeColor = 'purple'; // Padrão para rotas pendentes
          if (startEntregue && endEntregue) {
            routeColor = '#00C851'; // Verde para rotas onde ambos destinos foram entregues
          } else if (startEntregue || endEntregue) {
            routeColor = '#FF9800'; // Laranja para rotas parcialmente entregues
          }

          try {
            const response = await fetch(
              `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`
            );
            const data = await response.json();
            if (data.routes?.[0]?.geometry?.coordinates) {
              const coords = data.routes[0].geometry.coordinates.map(
                ([lng, lat]: [number, number]) => [lat, lng]
              );
              const polyline = L.polyline(coords, {
                color: routeColor,
                weight: 4,
                opacity: 0.7,
                dashArray: startEntregue && endEntregue ? '0' : '10, 5' // Linha sólida se entregue, tracejada se pendente
              }).addTo(mapInstanceRef.current!);
              routePolylinesRef.current.set(`${device.deviceId}-dest-${i}`, polyline);
            }
          } catch (error) {
            console.error('Erro ao buscar rota entre destinos:', error);
          }
        }
      }
    });
  }, [devices, isLoaded, isNFEntregue]);



  return (
    <div style={{ height: '100vh', width: '100%', position: 'relative' }}>
      {/* Legenda */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        zIndex: 1000,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        fontSize: '14px',
        fontFamily: 'Arial, sans-serif',
        minWidth: '200px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '10px', color: '#333' }}>
          📍 Legenda do Mapa
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ 
            width: '16px', 
            height: '16px', 
            backgroundColor: '#008000', 
            borderRadius: '50%', 
            marginRight: '8px' 
          }}></div>
          <span>Origem</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ 
            width: '0', 
            height: '0', 
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderBottom: '16px solid #FF0000',
            marginRight: '8px',
            marginLeft: '4px'
          }}></div>
          <span>Destino Pendente</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ 
            width: '0', 
            height: '0', 
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderBottom: '16px solid #00C851',
            marginRight: '8px',
            marginLeft: '4px'
          }}></div>
          <span>✅ Entregue</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ 
            width: '16px', 
            height: '12px', 
            backgroundColor: '#666', 
            marginRight: '8px',
            borderRadius: '2px'
          }}></div>
          <span>Posição Atual</span>
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
    </div>
  );
}