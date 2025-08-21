"use client"

import { useEffect, useState, useRef, useCallback } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

export interface Location {
  lat: number;
  lng: number;
}

interface TrackingMapProps {
  positions: Location[];
  center: Location;
  origem: Location | null;
  destino: Location | null;
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
    iconSize: [24, 24],
    iconAnchor: [10, 10],
  })
};

export function TrackingMap({ positions, center, origem, destino }: TrackingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [rota, setRota] = useState<Location[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Refs para elementos do mapa - nunca limpa automaticamente
  const markersRef = useRef<{
    origem?: L.Marker;
    destino?: L.Marker;
    posicaoAtual?: L.Marker;
  }>({});
  const polylinesRef = useRef<{
    rota?: L.Polyline;
    trilha?: L.Polyline;
  }>({});

  // Refs para controle de estado anterior
  const lastStateRef = useRef<{
    origemKey: string;
    destinoKey: string;
    positionKey: string;
    rotaLength: number;
    trilhaLength: number;
  }>({
    origemKey: '',
    destinoKey: '',
    positionKey: '',
    rotaLength: 0,
    trilhaLength: 0
  });

  // Função para gerar chaves únicas
  const generateKey = useCallback((location: Location | null) => {
    return location ? `${location.lat}-${location.lng}` : '';
  }, []);

  // Função para buscar rota - só uma vez por origem/destino
  const fetchRota = useCallback(async (origemCoord: Location, destinoCoord: Location) => {
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${origemCoord.lng},${origemCoord.lat};${destinoCoord.lng},${destinoCoord.lat}?overview=full&geometries=geojson`
      );
      const data = await response.json();
      if (data.routes?.[0]?.geometry?.coordinates) {
        const coords = data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number, number]) => ({ lat, lng })
        );
        setRota(coords);
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

  // Buscar rota apenas quando origem/destino mudarem PELA PRIMEIRA VEZ
  useEffect(() => {
    if (!origem || !destino || !isLoaded) return;

    const origemKey = generateKey(origem);
    const destinoKey = generateKey(destino);
    const combinedKey = `${origemKey}-${destinoKey}`;

    // Só busca se nunca buscou essa combinação antes
    if (`${lastStateRef.current.origemKey}-${lastStateRef.current.destinoKey}` !== combinedKey) {
      fetchRota(origem, destino);
      lastStateRef.current.origemKey = origemKey;
      lastStateRef.current.destinoKey = destinoKey;
    }
  }, [origem, destino, isLoaded, generateKey, fetchRota]);

  // Atualizar marcador de origem - só quando realmente mudar
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded || !origem) return;

    const origemKey = generateKey(origem);
    
    if (lastStateRef.current.origemKey !== origemKey || !markersRef.current.origem) {
      // Remove marcador anterior se existir
      if (markersRef.current.origem) {
        mapInstanceRef.current.removeLayer(markersRef.current.origem);
      }
      
      // Adiciona novo marcador
      const origemMarker = L.marker([origem.lat, origem.lng], { icon: icons.origem })
        .bindPopup('Origem')
        .addTo(mapInstanceRef.current);
      markersRef.current.origem = origemMarker;
    }
  }, [origem, isLoaded, generateKey]);

  // Atualizar marcador de destino - só quando realmente mudar
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded || !destino) return;

    const destinoKey = generateKey(destino);
    
    if (lastStateRef.current.destinoKey !== destinoKey || !markersRef.current.destino) {
      // Remove marcador anterior se existir
      if (markersRef.current.destino) {
        mapInstanceRef.current.removeLayer(markersRef.current.destino);
      }
      
      // Adiciona novo marcador
      const destinoMarker = L.marker([destino.lat, destino.lng], { icon: icons.destino })
        .bindPopup('Destino')
        .addTo(mapInstanceRef.current);
      markersRef.current.destino = destinoMarker;
    }
  }, [destino, isLoaded, generateKey]);

  // Atualizar rota - só quando ela mudar
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded) return;

    if (rota.length > 0 && rota.length !== lastStateRef.current.rotaLength) {
      // Remove rota anterior se existir
      if (polylinesRef.current.rota) {
        mapInstanceRef.current.removeLayer(polylinesRef.current.rota);
      }

      // Adiciona nova rota
      const rotaPolyline = L.polyline(rota.map(p => [p.lat, p.lng]), { 
        color: 'blue', 
        weight: 3 
      }).addTo(mapInstanceRef.current);
      polylinesRef.current.rota = rotaPolyline;

      lastStateRef.current.rotaLength = rota.length;
    }
  }, [rota, isLoaded]);

  // Atualizar posição atual - só quando mudar
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded || positions.length === 0) return;

    const currentPosition = positions[positions.length - 1];
    const positionKey = generateKey(currentPosition);
    
    if (lastStateRef.current.positionKey !== positionKey) {
      // Remove marcador anterior se existir
      if (markersRef.current.posicaoAtual) {
        mapInstanceRef.current.removeLayer(markersRef.current.posicaoAtual);
      }
      
      // Adiciona novo marcador
      const currentMarker = L.marker([currentPosition.lat, currentPosition.lng], { 
        icon: icons.posicaoAtual 
      })
        .bindPopup('Posição Atual')
        .addTo(mapInstanceRef.current);
      markersRef.current.posicaoAtual = currentMarker;

      lastStateRef.current.positionKey = positionKey;
    }
  }, [positions, isLoaded, generateKey]);

  // Atualizar trilha - só quando o número de posições mudar
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded || positions.length < 2) return;

    if (positions.length !== lastStateRef.current.trilhaLength) {
      // Remove trilha anterior se existir
      if (polylinesRef.current.trilha) {
        mapInstanceRef.current.removeLayer(polylinesRef.current.trilha);
      }

      // Adiciona nova trilha
      const trilhaPolyline = L.polyline(positions.map(p => [p.lat, p.lng]), { 
        color: 'red', 
        weight: 3,
        dashArray: '5, 5'
      }).addTo(mapInstanceRef.current);
      polylinesRef.current.trilha = trilhaPolyline;

      lastStateRef.current.trilhaLength = positions.length;
    }
  }, [positions, isLoaded]);

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