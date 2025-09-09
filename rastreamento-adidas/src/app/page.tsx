"use client"

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { io, Socket } from "socket.io-client";
import { Location } from "../components/TrackingMap";

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

const TrackingMap = dynamic(() => import("../components/TrackingMap").then(mod => mod.TrackingMap), {
  ssr: false
});

export default function HomePage() {
  const [center, setCenter] = useState<Location>({ lat: -23.55, lng: -46.63 });
  const [disconnectionLogs, setDisconnectionLogs] = useState<any[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [trackingStatus, setTrackingStatus] = useState<string>('Aguardando dispositivos...');
  const [routeData, setRouteData] = useState<any>(null);
  const [currentDeviceInfo, setCurrentDeviceInfo] = useState<any>(null);

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
        
        // Pegar informações do primeiro dispositivo ativo
        const activeDevice = data.devices[0];
        setCurrentDeviceInfo(activeDevice);
        
        // Centralizar no último aparelho ativo se tiver posições
        if (activeDevice.positions && activeDevice.positions.length > 0) {
          const lastPosition = activeDevice.positions[activeDevice.positions.length - 1];
          setCenter({ lat: lastPosition.lat, lng: lastPosition.lng });
        }
      } else {
        setTrackingStatus('Nenhum dispositivo ativo');
        setCurrentDeviceInfo(null);
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
          setCurrentDeviceInfo(null);
        }, 3000);
      }
    });

    // Eventos de dispositivos (SEM RELOAD)
    socket.on('device-connected', () => {
      console.log('Dispositivo conectado');
      setTrackingStatus('Novo dispositivo conectado');
    });
    
    socket.on('device-disconnected', () => {
      console.log('Dispositivo desconectado');
      setTrackingStatus('Dispositivo desconectado');
      setCurrentDeviceInfo(null);
      setRouteData(null);
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

  // Gerar link do Google Maps para o dispositivo atual
  const generateCurrentLocationLink = () => {
    if (!currentDeviceInfo || !currentDeviceInfo.positions || currentDeviceInfo.positions.length === 0) {
      return null;
    }
    
    const lastPosition = currentDeviceInfo.positions[currentDeviceInfo.positions.length - 1];
    return {
      link: `https://www.google.com/maps?q=${lastPosition.lat},${lastPosition.lng}&t=m&z=15`,
      deviceName: currentDeviceInfo.name,
      timestamp: lastPosition.timestamp
    };
  };

  // Status da conexão
  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#4CAF50';
      case 'connecting': return '#FF9800';
      case 'disconnected': return '#f44336';
      default: return '#757575';
    }
  };

  const currentLocationData = generateCurrentLocationLink();

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <TrackingMap socketUrl="" center={center} />
      
      {/* Painel de Status Principal */}
      <div style={{ 
        position: "absolute",
        top: "20px",
        left: "20px",
        backgroundColor: "rgba(255, 255, 255, 0.95)",
        padding: "15px",
        borderRadius: '12px',
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 1000,
        minWidth: "300px"
      }}>
        <h3 style={{ margin: "0 0 10px 0", fontSize: "18px", color: "#333" }}>
          Centro de Monitoramento
        </h3>
        
        {/* Status da conexão */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <div 
            style={{ 
              width: '12px', 
              height: '12px', 
              borderRadius: '50%',
              backgroundColor: getConnectionStatusColor()
            }}
          />
          <span style={{ fontSize: '14px', fontWeight: '500' }}>
            {connectionStatus === 'connected' ? 'Conectado' : 
             connectionStatus === 'connecting' ? 'Conectando...' : 'Desconectado'}
          </span>
        </div>

        {/* Status do rastreamento */}
        <div style={{ 
          backgroundColor: "#f5f5f5", 
          padding: "8px 12px", 
          borderRadius: "6px",
          marginBottom: "10px",
          fontSize: "14px"
        }}>
          {trackingStatus}
        </div>

        {/* Informações da rota ativa */}
        {routeData && (
          <div style={{ 
            backgroundColor: "#e8f5e8", 
            border: "1px solid #4CAF50",
            padding: "10px", 
            borderRadius: "6px",
            marginBottom: "10px",
            fontSize: "13px"
          }}>
            <div style={{ fontWeight: "bold", color: "#2E7D32", marginBottom: "4px" }}>
              Rota Ativa
            </div>
            <div>Rota: {routeData.rota || 'N/A'}</div>
            <div>Destinos: {routeData.totalDestinos || 0}</div>
            <div>Iniciado: {new Date(routeData.timestamp).toLocaleTimeString()}</div>
          </div>
        )}

        {/* Informações do dispositivo atual */}
        {currentDeviceInfo && (
          <div style={{ 
            backgroundColor: "#e3f2fd", 
            border: "1px solid #2196F3",
            padding: "10px", 
            borderRadius: "6px",
            fontSize: "13px",
            marginBottom: "10px"
          }}>
            <div style={{ fontWeight: "bold", color: "#1565C0", marginBottom: "4px" }}>
              Dispositivo Ativo
            </div>
            <div>Nome: {currentDeviceInfo.name}</div>
            <div>Posições: {currentDeviceInfo.positions?.length || 0}</div>
            {currentDeviceInfo.positions && currentDeviceInfo.positions.length > 0 && (
              <div>Última atualização: {new Date(currentDeviceInfo.lastUpdate).toLocaleTimeString()}</div>
            )}
          </div>
        )}

        {/* Link para posição atual */}
        {currentLocationData && (
          <div style={{ 
            backgroundColor: "#e8f5e8", 
            border: "1px solid #4CAF50",
            padding: "10px", 
            borderRadius: "6px",
            fontSize: "13px"
          }}>
            <div style={{ fontWeight: "bold", color: "#2E7D32", marginBottom: "4px" }}>
              Posição Atual
            </div>
            <div style={{ marginBottom: "6px", fontSize: "12px", color: "#666" }}>
              {new Date(currentLocationData.timestamp).toLocaleString()}
            </div>
            <a 
              href={currentLocationData.link} 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ 
                color: "#1976d2", 
                textDecoration: "none",
                fontSize: "12px",
                fontWeight: "bold"
              }}
            >
              Ver no Google Maps
            </a>
          </div>
        )}
      </div>

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