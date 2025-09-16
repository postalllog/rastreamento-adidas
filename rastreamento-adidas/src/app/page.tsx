"use client"

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { io, Socket } from "socket.io-client";
import { Location } from "../components/TrackingMap";
import { useRouter } from "next/navigation";

interface Device {
  deviceId: string;
  positions: Array<{ lat: number; lng: number; timestamp: number; isNewSegment?: boolean }>;
  origem: Location | null;
  destinos: Array<{ lat: number; lng: number; endereco?: string; nd?: string }> | null;
  color: string;
  name: string;
  lastUpdate: number;
  routeData?: any;
}

const TrackingMap = dynamic(() => import("../components/TrackingMap").then(mod => mod.TrackingMap), {
  ssr: false
});

export default function HomePage() {
  const [center, setCenter] = useState<Location>({ lat: -23.55, lng: -46.63 });
  const [disconnectionLogs, setDisconnectionLogs] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [trackingStatus, setTrackingStatus] = useState<string>('Aguardando dispositivos...');
  const [routeData, setRouteData] = useState<any>(null);
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const router = useRouter();

  useEffect(() => {
    // Carregar logs de desconexão do localStorage
    try {
      const savedLogs = JSON.parse(localStorage.getItem('disconnectionLogs') || '[]');
      setDisconnectionLogs(savedLogs);
    } catch (error) {
      console.error('Erro ao carregar logs:', error);
      localStorage.removeItem('disconnectionLogs');
      setDisconnectionLogs([]);
    }
    
    console.log('Conectando ao WebSocket na mesma porta');
    setConnectionStatus('connecting');
    
    const socket: Socket = io();

    socket.on('connect', () => {
      console.log('WebSocket conectado! ID:', socket.id);
      setConnectionStatus('connected');
      socket.emit('client-type', 'web');
    });
    
    socket.on('disconnect', () => {
      console.log('WebSocket desconectado');
      setConnectionStatus('disconnected');
      setTrackingStatus('Desconectado do servidor');
      window.location.reload();
    });
    
    socket.on('connect_error', (error) => {
      console.error('Erro de conexão WebSocket:', error);
      setConnectionStatus('disconnected');
      setTrackingStatus('Erro de conexão');
    });

    // Dados de dispositivos
    socket.on("all-devices-data", (data) => {
      console.log('HomePage - Dados de dispositivos recebidos:', data);
      
      if (data.devices && data.devices.length > 0) {
        setTrackingStatus(`${data.devices.length} dispositivo(s) ativo(s)`);
        setAllDevices(data.devices);
      } else {
        setTrackingStatus('Nenhum dispositivo ativo');
        setAllDevices([]);
      }
    });

    // Dados de rota recebidos
    socket.on("route-received", (data) => {
      console.log('HomePage - Dados de rota recebidos:', data);
      setRouteData(data.routeData);
      setTrackingStatus(`Rota recebida: ${data.routeData.rota || 'N/A'} - ${data.routeData.totalDestinos || 0} destinos`);
    });

    // Status de rastreamento
    socket.on("tracking-status", (data) => {
      console.log('HomePage - Status de rastreamento:', data);
      if (data.status === 'started') {
        setTrackingStatus(`Rastreamento iniciado: ${data.data.deviceName}`);
      } else if (data.status === 'stopped') {
        setTrackingStatus(`Rastreamento encerrado: ${data.data.deviceName}`);
        // Limpar dados após 3 segundos
        setTimeout(() => {
          setRouteData(null);
          setAllDevices([]);
        }, 3000);
      }
    });

    // Eventos de dispositivos (SEM RELOAD)
    socket.on('device-connected', () => {
      console.log('Dispositivo conectado');
      setTrackingStatus('Novo dispositivo conectado');
    });
    
    socket.on('device-disconnected', () => {
      console.log('Dispositivo desconectado - RECARREGANDO PÁGINA');
      setTrackingStatus('Dispositivo desconectado');
      setAllDevices([]);
      setRouteData(null);
      window.location.reload();
    });
    
    // Logs de desconexão
    socket.on('device-disconnection-log', (log) => {
      console.log('Log de desconexão recebido:', log);
      try {
        const existingLogs = JSON.parse(localStorage.getItem('disconnectionLogs') || '[]');
        const updatedLogs = [log, ...existingLogs.slice(0, 9)];
        localStorage.setItem('disconnectionLogs', JSON.stringify(updatedLogs));
        setDisconnectionLogs(updatedLogs);
        setTrackingStatus(`${log.deviceName} desconectado`);
      } catch (error) {
        console.error('Erro ao salvar log:', error);
        setDisconnectionLogs([log]);
      }
    });

    return () => {
      socket.disconnect();
    }
  }, []);

  const generateCurrentLocationLink = () => {
    if (!allDevices.length || !allDevices[0].positions || allDevices[0].positions.length === 0) {
      return null;
    }
    
    const firstDevice = allDevices[0];
    const lastPosition = firstDevice.positions[firstDevice.positions.length - 1];
    return {
      link: `https://www.google.com/maps?q=${lastPosition.lat},${lastPosition.lng}&t=m&z=15`,
      deviceName: firstDevice.name,
      timestamp: lastPosition.timestamp
    };
  };

  /* Status da conexão
  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#4CAF50';
      case 'connecting': return '#FF9800';
      case 'disconnected': return '#f44336';
      default: return '#757575';
    }
  };
  */

  const currentLocationData = generateCurrentLocationLink();

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <TrackingMap devices={allDevices} center={center} />
      


      {/* Painel de Logs de Desconexão */}
       <div style={{ 
        position: "absolute",
        top: "20px",
        right: "20px",
        width: "300px",
        maxHeight: "400px",
        backgroundColor: "rgba(255, 255, 255, 0.95)",
        padding: "15px",
        overflowY: "auto",
        borderRadius: '12px',
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 999
      }}>
        <h3 style={{ margin: "0 0 15px 0", fontSize: "16px", color: "#333" }}>
          Logs de Desconexão
        </h3>
        
        {disconnectionLogs.map((log, index) => (
          <div key={index} style={{
            backgroundColor: "#ffebee",
            border: "1px solid #ffcdd2",
            borderRadius: "6px",
            padding: "10px",
            marginBottom: "10px",
            fontSize: "12px"
          }}>
            <div style={{ fontWeight: "bold", marginBottom: "6px", color: "#d32f2f" }}>
              DESCONECTADO
            </div>
            <div style={{ marginBottom: "4px", fontSize: "11px" }}>
              {log.deviceName}
            </div>
            <div style={{ marginBottom: "4px", fontSize: "11px", color: "#666" }}>
              {new Date(log.timestamp).toLocaleString()}
            </div>
            <div style={{ marginBottom: "8px", fontSize: "10px", color: "#666" }}>
              {log.position.lat.toFixed(4)}, {log.position.lng.toFixed(4)}
            </div>
            <a 
              href={log.googleMapsLink} 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ 
                color: "#1976d2", 
                textDecoration: "none",
                fontSize: "11px",
                fontWeight: "bold"
              }}
            >
              Ver última posição
            </a>
          </div>
        ))}
        
        {disconnectionLogs.length === 0 && (
          <div style={{ 
            textAlign: "center", 
            color: "#666", 
            fontSize: "13px",
            marginTop: "20px"
          }}>
            Nenhuma desconexão registrada
          </div>
        )}
      </div>
    </div>
  );
}