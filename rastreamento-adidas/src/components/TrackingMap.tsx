"use client"

import { useEffect, useState, useRef, useCallback } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

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
    iconUrl: '/marker-icon.png',
    iconSize: [41, 41],
    iconAnchor: [41, 41],
  }),
  posicaoAtual: new L.Icon({
    iconUrl: '/caminhao-icon.png',
    iconSize: [30, 30],
    iconAnchor: [10, 10],
  })
};

export function TrackingMap({ devices, center }: TrackingMapProps) {
  console.log('🗺️ TrackingMap recebeu devices:', devices);
  
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Refs para elementos do mapa
  const markersRef = useRef<Map<string, L.Marker[]>>(new Map());
  const polylinesRef = useRef<Map<string, L.Polyline[]>>(new Map());
  const routePolylinesRef = useRef<Map<string, L.Polyline>>(new Map());

  // Controle de estado anterior por aparelho
  const lastStateRef = useRef<Map<string, any>>(new Map());

  // Função para criar segmentos separados baseado em gaps de tempo
  const createSegments = useCallback((positions: Device['positions']) => {
    console.log('📊 createSegments recebeu:', positions.length, 'posições');
    const segments: Location[][] = [];
    let currentSegment: Location[] = [];
    
    positions.forEach((pos, index) => {
      if (pos.isNewSegment && currentSegment.length > 0) {
        console.log('✂️ Novo segmento detectado no índice', index);
        segments.push([...currentSegment]);
        currentSegment = [];
      }
      currentSegment.push({ lat: pos.lat, lng: pos.lng });
    });
    
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }
    
    console.log('📊 Segmentos criados:', segments.length, 'segmentos');
    segments.forEach((seg, i) => console.log(`Segmento ${i + 1}:`, seg.length, 'pontos'));
    
    return segments;
  }, []);

  // Função para buscar rota OSRM
  const fetchRoute = useCallback(async (origem: Location, destino: Location, deviceId: string) => {
    try {
      console.log(`🗺️ Buscando rota para ${deviceId}`);
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
          console.log(`✅ Rota criada para ${deviceId}`);
        }
      }
    } catch (error) {
      console.error('Erro ao buscar rota:', error);
    }
  }, []);

  // Inicializar o mapa APENAS UMA VEZ
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const initMap = () => {
      try {
        if (mapRef.current && (mapRef.current as any)._leaflet_id) {
          return;
        }

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
    
    // Cleanup APENAS quando o componente for desmontado
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []); // Dependência vazia - só executa uma vez

  // Renderizar todos os aparelhos
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded) return;

    console.log('🗺️ Renderizando aparelhos:', devices.length);
    devices.forEach(device => {
      console.log(`📱 Aparelho ${device.name}:`, {
        positions: device.positions.length,
        origem: device.origem,
        destino: device.destino,
        color: device.color
      });
    });

    // Limpar elementos anteriores
    markersRef.current.forEach(markers => {
      markers.forEach(marker => mapInstanceRef.current?.removeLayer(marker));
    });
    polylinesRef.current.forEach(polylines => {
      polylines.forEach(polyline => mapInstanceRef.current?.removeLayer(polyline));
    });
    markersRef.current.clear();
    polylinesRef.current.clear();

    // Renderizar cada aparelho
    devices.forEach(device => {
      const deviceMarkers: L.Marker[] = [];
      const devicePolylines: L.Polyline[] = [];

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

      // Buscar e desenhar rota planejada (azul) se origem e destino existem
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
          .bindPopup(`${device.name} - Posição Atual`)
          .addTo(mapInstanceRef.current!);
        deviceMarkers.push(currentMarker);
      }

      // Criar segmentos separados para evitar linhas atravessando obstáculos
      if (device.positions.length > 1) {
        console.log(`🛣️ Criando trajeto para ${device.name} com ${device.positions.length} posições`);
        
        // Verificar se há movimento real
        const firstPos = device.positions[0];
        const lastPos = device.positions[device.positions.length - 1];
        const hasMoved = firstPos.lat !== lastPos.lat || firstPos.lng !== lastPos.lng;
        
        if (!hasMoved) {
          console.log(`⚠️ ${device.name} não se moveu - todas as posições são iguais`);
          // Não criar trajeto se não houve movimento
        } else {
          const segments = createSegments(device.positions);
          console.log(`📊 Segmentos criados:`, segments.length);
          
          segments.forEach((segment, index) => {
            if (segment.length > 1) {
              console.log(`➡️ Segmento ${index + 1}: ${segment.length} pontos`);
              const polyline = L.polyline(segment.map(p => [p.lat, p.lng]), {
                color: device.color,
                weight: 3,
                dashArray: index > 0 ? '10, 5' : '5, 5',
                opacity: 0.8
              }).addTo(mapInstanceRef.current!);
              devicePolylines.push(polyline);
            }
          });
        }
      } else {
        console.log(`⚠️ ${device.name} tem apenas ${device.positions.length} posições - não criando trajeto`);
      }

      markersRef.current.set(device.deviceId, deviceMarkers);
      polylinesRef.current.set(device.deviceId, devicePolylines);
    });
  }, [devices, isLoaded, createSegments]);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
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
          padding: '10px 20px',
          borderRadius: '5px',
          fontSize: '14px'
        }}>
          Carregando mapa...
        </div>
      )}
    </div>
  );
}