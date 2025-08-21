"use client"

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { io, Socket } from "socket.io-client";
import { Location } from "../components/TrackingMap";


const TrackingMap = dynamic(() => import("../components/TrackingMap").then(mod => mod.TrackingMap), {
  ssr: false
});

export default function HomePage() {
  const [positions, setPositions] = useState<Location[]>([]);
  const [center, setCenter] = useState<Location>({ lat: -23.55, lng: -46.63 });
  const [origem, setOrigem] = useState<Location | null>(null);
  const [destino, setDestino] = useState<Location | null>(null);

  useEffect(() => {
    console.log('🔗 Conectando ao WebSocket na mesma porta');
    
    const socket: Socket = io(); // Conecta na mesma porta do Next.js


    
    socket.on('connect', () => {
      console.log('✅ WebSocket conectado! ID:', socket.id);
      // Identificar como cliente web
      socket.emit('client-type', 'web');
    });
    
    socket.on('disconnect', () => {
      console.log('❌ WebSocket desconectado');
    });
    
    socket.on('connect_error', (error) => {
      console.error('⚠️ Erro de conexão WebSocket:', error);
    });

    socket.on("posicao-atual", async (data) => {
      console.log('📍 Dados recebidos no frontend:', data);
      if (data.origem) setOrigem({ lat: data.origem[0], lng: data.origem[1] });
      
      if (data.destino) {
        setDestino({ lat: data.destino[0], lng: data.destino[1] });
      } else if (data.destinoTexto && !destino) {
        // Geocodificar o endereço de destino
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(data.destinoTexto + ', Brasil')}&limit=1`
          );
          const results = await response.json();
          if (results.length > 0) {
            const coords = { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
            setDestino(coords);
            console.log('Destino geocodificado:', coords);
          }
        } catch (error) {
          console.error('Erro ao geocodificar destino:', error);
        }
      }
      
      if (data.coords) {
        const newPos = { lat: data.coords[0], lng: data.coords[1] };
        setPositions((prev) => [...prev, newPos]);
        setCenter(newPos);
      }
    });

    return () => {socket.disconnect();}
  }, []);

  return (
    <div style={{ height: "100vh" }}>
      <TrackingMap positions={positions} center={center} origem={origem} destino={destino} />
    </div>
  );
}
