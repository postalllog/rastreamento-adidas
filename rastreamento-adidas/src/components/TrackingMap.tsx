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
    if (!nd || !device.nfs) {
      console.log(`🔍 isNFEntregue: nd=${nd}, device.nfs exists=${!!device.nfs}`);
      return false;
    }
    
    console.log(`🔍 Verificando NF ${nd} no dispositivo ${device.name}:`);
    console.log(`📦 NFs do dispositivo:`, device.nfs);
    
    const nf = device.nfs.find(nf => nf.nd === nd);
    console.log(`🎯 NF encontrada:`, nf);
    
    // Verificar múltiplos status que indicam entrega
    const statusesEntregues = ['delivered', 'entregue', 'concluido', 'concluída', 'finalizado', 'completed'];
    const isEntregue = nf ? statusesEntregues.includes(nf.status.toLowerCase()) : false;
    console.log(`✅ Status entregue: ${isEntregue} (status: ${nf?.status}) - Comparando com: ${statusesEntregues}`);
    
    return isEntregue;
  }, []);

  // Função para obter próximo destino não entregue
  const getProximoDestinoNaoEntregue = useCallback((device: Device): { lat: number; lng: number; endereco?: string; nd?: string } | null => {
    if (!device.destinos || device.destinos.length === 0) return null;
    
    const destinosNaoEntregues = device.destinos.filter(destino => !isNFEntregue(device, destino.nd));
    
    console.log(`🎯 Próximos destinos não entregues para ${device.name}:`, destinosNaoEntregues.map(d => ({ nd: d.nd, endereco: d.endereco })));
    
    return destinosNaoEntregues.length > 0 ? destinosNaoEntregues[0] : null;
  }, [isNFEntregue]);

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

  // Múltiplas APIs de roteamento com fallback automático
  const routeProviders = [
    {
      name: 'Mapbox',
      url: (origem: Location, destino: Location) => 
        `https://api.mapbox.com/directions/v5/mapbox/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?geometries=geojson&access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw`,
      parseCoords: (data: any) => data.routes?.[0]?.geometry?.coordinates?.map(([lng, lat]: [number, number]) => [lat, lng])
    },

    {
      name: 'OSRM',
      url: (origem: Location, destino: Location) => 
        `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`,
      parseCoords: (data: any) => data.routes?.[0]?.geometry?.coordinates?.map(([lng, lat]: [number, number]) => [lat, lng])
    },
    {
      name: 'GraphHopper',
      url: (origem: Location, destino: Location) => 
        `https://graphhopper.com/api/1/route?point=${origem.lat},${origem.lng}&point=${destino.lat},${destino.lng}&vehicle=car&locale=pt&calc_points=true&debug=true&elevation=false&type=json`,
      parseCoords: (data: any, decoder: any) => data.paths?.[0]?.points ? decoder(data.paths[0].points) : null
    }
  ];

  // Função para decodificar polyline do GraphHopper
  const decodePolyline = useCallback((encoded: string) => {
    const points = [];
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;

    while (index < len) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
      lng += dlng;

      points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
  }, []);

  // Função principal para buscar rota com múltiplas APIs
  const fetchRoute = useCallback(async (origem: Location, destino: Location, deviceId: string) => {
    // Validar coordenadas
    if (!origem.lat || !origem.lng || !destino.lat || !destino.lng) {
      console.warn('Coordenadas inválidas para rota principal:', { origem, destino });
      return;
    }

    const routeKey = `main-${deviceId}`;
    console.log(`🗺️ Sistema multi-API ativo: ${routeProviders.map(p => p.name).join(', ')} (${routeProviders.length} provedores)`);
    
    // Tentar cada provedor em sequência
    for (let i = 0; i < routeProviders.length; i++) {
      const provider = routeProviders[i];
      
      try {
        // Delay progressivo para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 300 * i));
        
        const url = provider.url(origem, destino);
        console.log(`🌐 Tentando ${provider.name}:`, url);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'RastreamentoAdidas/1.0'
          }
        });
        
        if (!response.ok) {
          console.warn(`⚠️ ${provider.name} retornou ${response.status}`);
          continue; // Tentar próximo provedor
        }
        
        const data = await response.json();
        
        // Processar coordenadas baseado no provedor
        let coords = null;
        if (provider.name === 'GraphHopper' && data.paths?.[0]?.points) {
          coords = provider.parseCoords(data, decodePolyline);
        } else {
          coords = provider.parseCoords(data, decodePolyline);
        }
        
        if (coords && coords.length > 0) {
          // Remover rota anterior se existir
          const existingRoute = routePolylinesRef.current.get(deviceId);
          if (existingRoute && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(existingRoute);
          }
          
          // Adicionar nova rota principal
          if (mapInstanceRef.current) {
            const routePolyline = L.polyline(coords, {
              color: '#1E90FF', // Azul mais vibrante para rota principal
              weight: 5,
              opacity: 0.8
            }).addTo(mapInstanceRef.current);
            routePolylinesRef.current.set(deviceId, routePolyline);
            console.log(`✅ Rota principal obtida via ${provider.name}`);
            return; // Sucesso! Sair da função
          }
        } else {
          console.warn(`⚠️ ${provider.name} não retornou coordenadas válidas`);
        }
      } catch (error) {
        console.error(`❌ Erro no ${provider.name}:`, error instanceof Error ? error.message : error);
        continue; // Tentar próximo provedor
      }
    }
    
    // Se todos os provedores falharam, criar linha reta
    console.log('🔄 Todos os provedores falharam, criando linha reta...');
    try {
      if (mapInstanceRef.current) {
        const existingRoute = routePolylinesRef.current.get(deviceId);
        if (existingRoute) {
          mapInstanceRef.current.removeLayer(existingRoute);
        }
        
        const straightLine = L.polyline([[origem.lat, origem.lng], [destino.lat, destino.lng]], {
          color: '#1E90FF',
          weight: 4,
          opacity: 0.6,
          dashArray: '12, 8' // Padrão diferente para identificar fallback
        }).addTo(mapInstanceRef.current);
        routePolylinesRef.current.set(deviceId, straightLine);
        console.log('✅ Linha reta principal criada como fallback final');
      }
    } catch (fallbackError) {
      console.error('❌ Erro ao criar linha reta principal:', fallbackError);
    }
  }, [decodePolyline]);



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
      console.log(`� NFs para ${device.name}:`, device.nfs);
      console.log(`�📍 Tipo dos destinos:`, typeof device.destinos, Array.isArray(device.destinos));
      
      if (device.destinos && device.destinos.length > 0) {
        console.log(`🎯 ${device.destinos.length} destinos encontrados:`);
        device.destinos.forEach((dest, i) => {
          console.log(`  ${i + 1}. lat: ${dest?.lat}, lng: ${dest?.lng}, endereco: ${dest?.endereco}, nd: ${dest?.nd}`);
          console.log(`      Tipo lat: ${typeof dest?.lat}, Tipo lng: ${typeof dest?.lng}`);
        });
      } else {
        console.log(`❌ NENHUM DESTINO para ${device.name}`);
      }

      if (device.nfs && device.nfs.length > 0) {
        console.log(`📦 ${device.nfs.length} NFs encontradas:`);
        device.nfs.forEach((nf, i) => {
          console.log(`  ${i + 1}. nd: ${nf?.nd}, status: ${nf?.status}, nfe: ${nf?.nfe}`);
        });
      } else {
        console.log(`❌ NENHUMA NF para ${device.name}`);
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
              console.log(`🔍 Verificando status para destino ${index + 1}: ND=${destino.nd}`);
              const foiEntregue = isNFEntregue(device, destino.nd);
              const iconToUse = foiEntregue ? icons.destinoEntregue : icons.destino;
              const statusText = foiEntregue ? '✅ ENTREGUE' : '📦 Pendente';
              console.log(`🎯 Resultado: ${foiEntregue ? 'ENTREGUE' : 'PENDENTE'} para ND ${destino.nd}`);
              
              // Verificar se é o próximo destino não entregue
              const proximoDestino = getProximoDestinoNaoEntregue(device);
              const isProximoDestino = proximoDestino && proximoDestino.nd === destino.nd;
              
              const destinoMarker = L.marker([destino.lat, destino.lng], { icon: iconToUse })
                .bindPopup(`
                  <strong>${device.name} - Destino ${index + 1}</strong><br>
                  ${destino.endereco ? `Endereço: ${destino.endereco}<br>` : ''}
                  ${destino.nd ? `ND: ${destino.nd}<br>` : ''}
                  <strong>Status: ${statusText}</strong><br>
                  ${isProximoDestino ? '<span style="color: #1E90FF; font-weight: bold;">📍 PRÓXIMO DESTINO</span>' : ''}
                  ${foiEntregue ? '<span style="color: #666; font-style: italic;">🚫 Não será roteado</span>' : ''}
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
        // Encontrar primeiro destino não entregue
        const firstDestinoNaoEntregue = device.destinos.find(destino => !isNFEntregue(device, destino.nd));
        
        if (firstDestinoNaoEntregue) {
          const routeKey = `${device.origem.lat}-${device.origem.lng}-${firstDestinoNaoEntregue.lat}-${firstDestinoNaoEntregue.lng}`;
          const lastRouteKey = lastStateRef.current.get(device.deviceId)?.routeKey;
          
          if (routeKey !== lastRouteKey) {
            console.log(`🎯 Traçando rota principal para primeiro destino não entregue (ND: ${firstDestinoNaoEntregue.nd})`);
            fetchRoute(device.origem, firstDestinoNaoEntregue, device.deviceId);
            if (!lastStateRef.current.has(device.deviceId)) {
              lastStateRef.current.set(device.deviceId, {});
            }
            lastStateRef.current.get(device.deviceId).routeKey = routeKey;
          }
        } else {
          // Todos os destinos foram entregues - remover rota principal
          const existingRoute = routePolylinesRef.current.get(device.deviceId);
          if (existingRoute && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(existingRoute);
            routePolylinesRef.current.delete(device.deviceId);
            console.log(`✅ Todos os destinos entregues - rota principal removida para ${device.name}`);
          }
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
  }, [devices, isLoaded, createSegments, fetchRoute, isNFEntregue, getProximoDestinoNaoEntregue]);

  // Função para buscar rota entre destinos consecutivos com múltiplas APIs
  const fetchDestinationRoute = useCallback(async (start: Location, end: Location, routeKey: string, routeColor: string, dashArray: string) => {
    // Validar coordenadas
    if (!start.lat || !start.lng || !end.lat || !end.lng) {
      console.warn('Coordenadas inválidas para rota entre destinos:', { start, end });
      return;
    }

    const routeIndex = parseInt(routeKey.split('-dest-')[1]) || 0;
    
    // Tentar apenas os provedores mais confiáveis para rotas secundárias
    const secondaryProviders = routeProviders.slice(0, 2); // Mapbox e OSRM primeiro
    
    for (let i = 0; i < secondaryProviders.length; i++) {
      const provider = secondaryProviders[i];
      
      try {
        // Delay progressivo para evitar rate limiting
        const delay = 600 + (routeIndex * 400) + (i * 200);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        const url = provider.url(start, end);
        console.log(`🔗 Tentando ${provider.name} para rota ${routeKey}:`, url);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'RastreamentoAdidas/1.0'
          }
        });
        
        if (!response.ok) {
          console.warn(`⚠️ ${provider.name} retornou ${response.status} para ${routeKey}`);
          continue;
        }
        
        const data = await response.json();
        
        // Processar coordenadas
        let coords = null;
        if (provider.name === 'GraphHopper' && data.paths?.[0]?.points) {
          coords = provider.parseCoords(data, decodePolyline);
        } else {
          coords = provider.parseCoords(data, decodePolyline);
        }
        
        if (coords && coords.length > 0) {
          // Remover rota anterior se existir
          const existingRoute = routePolylinesRef.current.get(routeKey);
          if (existingRoute && mapInstanceRef.current) {
            mapInstanceRef.current.removeLayer(existingRoute);
          }
          
          // Adicionar nova rota entre destinos
          if (mapInstanceRef.current) {
            const polyline = L.polyline(coords, {
              color: routeColor,
              weight: 4,
              opacity: 0.8,
              dashArray: dashArray
            }).addTo(mapInstanceRef.current);
            routePolylinesRef.current.set(routeKey, polyline);
            console.log(`✅ Rota ${routeKey} obtida via ${provider.name} (${routeColor})`);
            return; // Sucesso!
          }
        } else {
          console.warn(`⚠️ ${provider.name} não retornou coordenadas para ${routeKey}`);
        }
      } catch (error) {
        console.error(`❌ Erro no ${provider.name} para ${routeKey}:`, error instanceof Error ? error.message : error);
        continue;
      }
    }
    
    // Fallback: criar linha reta se todos falharam
    console.log(`🔄 Criando linha reta como fallback para ${routeKey}...`);
    try {
      if (mapInstanceRef.current) {
        const existingRoute = routePolylinesRef.current.get(routeKey);
        if (existingRoute) {
          mapInstanceRef.current.removeLayer(existingRoute);
        }
        
        const straightLine = L.polyline([[start.lat, start.lng], [end.lat, end.lng]], {
          color: routeColor,
          weight: 3,
          opacity: 0.6,
          dashArray: dashArray || '15, 10' // Linha mais tracejada para fallback
        }).addTo(mapInstanceRef.current);
        routePolylinesRef.current.set(routeKey, straightLine);
        console.log(`✅ Linha reta criada como fallback para ${routeKey}`);
      }
    } catch (fallbackError) {
      console.error(`❌ Erro ao criar linha reta entre destinos ${routeKey}:`, fallbackError);
    }
  }, [decodePolyline]);

  // useEffect separado para rotas entre destinos consecutivos (apenas não entregues)
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded) return;

    console.log('🗺️ Processando rotas entre destinos não entregues...');

    devices.forEach(async (device) => {
      // Primeiro, limpar todas as rotas existentes entre destinos
      for (let i = 0; i < 20; i++) { // Limpar até 20 possíveis rotas
        const routeKey = `${device.deviceId}-dest-${i}`;
        const existingRoute = routePolylinesRef.current.get(routeKey);
        if (existingRoute && mapInstanceRef.current) {
          mapInstanceRef.current.removeLayer(existingRoute);
          routePolylinesRef.current.delete(routeKey);
        }
      }

      if (device.destinos && device.destinos.length > 1) {
        // Filtrar apenas destinos não entregues
        const destinosNaoEntregues = device.destinos.filter(destino => !isNFEntregue(device, destino.nd));
        
        console.log(`🔗 Destinos não entregues para ${device.name}:`, destinosNaoEntregues.length);
        console.log(`📦 Detalhes dos destinos não entregues:`, destinosNaoEntregues.map(d => ({ nd: d.nd, endereco: d.endereco })));
        
        if (destinosNaoEntregues.length > 1) {
          // Criar rotas apenas entre destinos não entregues consecutivos
          for (let i = 0; i < destinosNaoEntregues.length - 1; i++) {
            const start = destinosNaoEntregues[i];
            const end = destinosNaoEntregues[i + 1];
            const routeKey = `${device.deviceId}-pending-${i}`;

            // Verificar se ambos os destinos não foram entregues (redundante mas para segurança)
            const startEntregue = isNFEntregue(device, start.nd);
            const endEntregue = isNFEntregue(device, end.nd);
            
            console.log(`📦 Rota pendente ${i + 1} → ${i + 2}: ${start.nd} (${startEntregue ? 'ENTREGUE' : 'PENDENTE'}) → ${end.nd} (${endEntregue ? 'ENTREGUE' : 'PENDENTE'})`);
            
            if (!startEntregue && !endEntregue) {
              // Definir cor da rota para destinos pendentes
              const routeColor = '#8A2BE2'; // Roxo para rotas entre destinos pendentes
              const dashArray = '10, 5'; // Tracejada

              console.log(`🎨 Criando rota pendente ${i + 1}→${i + 2}: ${start.nd} → ${end.nd} (${routeColor})`);

              // Buscar rota com delay
              await fetchDestinationRoute(start, end, routeKey, routeColor, dashArray);
            } else {
              console.log(`⚠️ Pulando rota ${i + 1}→${i + 2} pois um dos destinos já foi entregue`);
            }
          }
        } else {
          console.log(`✅ ${device.name}: ${destinosNaoEntregues.length <= 1 ? 'Nenhum ou apenas 1 destino pendente' : 'Todos os destinos foram entregues'}`);
        }
      } else {
        console.log(`⚠️ Dispositivo ${device.name} não tem destinos suficientes para rotas`);
      }
    });
  }, [devices, isLoaded, isNFEntregue, fetchDestinationRoute]);



  return (
    <div style={{ height: '100vh', width: '100%', position: 'relative' }}>
        

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