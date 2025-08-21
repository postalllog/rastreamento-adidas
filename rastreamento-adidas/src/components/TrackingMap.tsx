"use client"

import { useEffect, useState } from "react";
import { MapContainer, Marker, TileLayer, Polyline, useMap } from "react-leaflet";
import { Icon, LatLngExpression } from "leaflet";
import 'leaflet/dist/leaflet.css';

export interface Location { lat: number; lng: number; }

interface TrackingMapProps {
  positions: Location[];
  center: Location;
  origem: Location | null;
  destino: Location | null;
}

function CenterView({ center }: { center: Location }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([center.lat, center.lng]);
  }, [center, map]);
  return null;
}


const origemIcon = new Icon({
  iconUrl: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="%23008000" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2z"/></svg>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const destinoIcon = new Icon({
  iconUrl: '/marker-icon.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const posicaoAtualIcon = new Icon({
  iconUrl: '/caminhao-icon.png',
  iconSize: [24, 24],
  iconAnchor: [10, 10],
});

export function TrackingMap({ positions, center, origem, destino }: TrackingMapProps) {
  const [rota, setRota] = useState<Location[]>([]);

  useEffect(() => {
    console.log('TrackingMap - Origem:', origem, 'Destino:', destino);
    
    async function fetchRota() {
      if (!origem || !destino) {
        console.log('Origem ou destino não definidos');
        return;
      }
      
      console.log('Calculando rota...');

      try {
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`
        );

        const data = await response.json();
        if (data.routes?.[0]?.geometry?.coordinates) {
          const coords = data.routes[0].geometry.coordinates.map(
            ([lng, lat]: [number, number]) => ({ lat, lng })
          );
          console.log('Rota calculada com', coords.length, 'pontos');
          setRota(coords);
        } else {
          console.log('Nenhuma rota encontrada');
        }
      } catch (error) {
        console.error('Erro ao buscar rota:', error);
      }
    }

    fetchRota();
  }, [origem, destino]);



  return (
    <MapContainer
      center={[center.lat, center.lng] as LatLngExpression}
      zoom={13}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <CenterView center={center} />

      {origem && <Marker position={[origem.lat, origem.lng]} icon={origemIcon} />}
      {destino && <Marker position={[destino.lat, destino.lng]} icon={destinoIcon} />}
      {positions.length > 0 && (
        <Marker
          position={[positions[positions.length - 1].lat, positions[positions.length - 1].lng]}
          icon={posicaoAtualIcon}
        />
      )}



      {rota.length > 0 && (
        <Polyline
          positions={rota.map(p => [p.lat, p.lng] as LatLngExpression)}
          pathOptions={{ color: 'blue', weight: 3 }}
        />
      )}

      {positions.length > 1 && (
        <Polyline
          positions={positions.map(p => [p.lat, p.lng] as LatLngExpression)}
          pathOptions={{ color: 'red', weight: 3, dashArray: '5,5' }}
        />
      )}
    </MapContainer>
  );
}
