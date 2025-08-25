"use client"

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { io, Socket } from "socket.io-client";
import { Location } from "../components/TrackingMap";


const TrackingMap = dynamic(() => import("../components/TrackingMap").then(mod => mod.TrackingMap), {
  ssr: false
});

export default function HomePage() {
  const [devices, setDevices] = useState<any[]>([]);
  const [center, setCenter] = useState<Location>({ lat: -23.55, lng: -46.63 });

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

    socket.on("all-devices-data", (data) => {
      console.log('📍 Dados de todos os aparelhos recebidos:', data);
      setDevices(data.devices);
      
      // Centralizar no último aparelho ativo
      if (data.devices.length > 0) {
        const lastActiveDevice = data.devices.reduce((latest: any, device: any) => 
          device.lastUpdate > latest.lastUpdate ? device : latest
        );
        
        if (lastActiveDevice.positions.length > 0) {
          const lastPosition = lastActiveDevice.positions[lastActiveDevice.positions.length - 1];
          setCenter({ lat: lastPosition.lat, lng: lastPosition.lng });
        }
      }
    });

    return () => {socket.disconnect();}
  }, []);

  return (
    <div style={{ height: "100vh" }}>
      <TrackingMap devices={devices} center={center} />
    </div>
  );
}
