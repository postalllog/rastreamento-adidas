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
  const [backupLogs, setBackupLogs] = useState<Map<string, any[]>>(new Map());
  const [disconnectionLogs, setDisconnectionLogs] = useState<any[]>([]);

  useEffect(() => {
    // Carregar logs de desconexão do localStorage
    const savedLogs = JSON.parse(localStorage.getItem('disconnectionLogs') || '[]');
    setDisconnectionLogs(savedLogs);
    
    console.log('🔗 Conectando ao WebSocket na mesma porta');
    
    const socket: Socket = io(); // Conecta na mesma porta do Next.js


    
    socket.on('connect', () => {
      console.log('✅ WebSocket conectado! ID:', socket.id);
      socket.emit('client-type', 'web');
    });
    
    socket.on('disconnect', () => {
      console.log('❌ WebSocket desconectado');
      
      // Salvar última posição
      if (devices.length > 0) {
        const activeDevice = devices.find(d => d.positions.length > 0);
        if (activeDevice) {
          const lastPosition = activeDevice.positions[activeDevice.positions.length - 1];
          const disconnectionLog = {
            timestamp: new Date().toISOString(),
            deviceName: activeDevice.name,
            position: { lat: lastPosition.lat, lng: lastPosition.lng },
            googleMapsLink: `https://www.google.com/maps?q=${lastPosition.lat},${lastPosition.lng}&t=m&z=15`
          };
          
          const existingLogs = JSON.parse(localStorage.getItem('disconnectionLogs') || '[]');
          const updatedLogs = [disconnectionLog, ...existingLogs.slice(0, 9)];
          localStorage.setItem('disconnectionLogs', JSON.stringify(updatedLogs));
          setDisconnectionLogs(updatedLogs);
        }
      }
    });
    
    // Eventos específicos para conexão/desconexão de usuários
    socket.on('user-connected', () => {
      window.location.reload();
    });
    
    socket.on('user-disconnected', () => {
      window.location.reload();
    });
    
    socket.on('connect_error', (error) => {
      console.error('⚠️ Erro de conexão WebSocket:', error);
    });

    socket.on("all-devices-data", (data) => {
      console.log('📍 Dados de todos os aparelhos recebidos:', JSON.stringify(data, null, 2));
      console.log('📊 Número de aparelhos:', data.devices?.length || 0);
      setDevices(data.devices || []);
      
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

    socket.on("backup-logs", (data) => {
      console.log('📝 Logs de backup recebidos:', data);
      setBackupLogs(prev => {
        const newMap = new Map(prev);
        newMap.set(data.deviceId, data.logs);
        return newMap;
      });
    });
    
    socket.on('device-connected', () => {
      console.log('📱 Dispositivo conectado');
      window.location.reload();
    });
    
    socket.on('device-disconnected', () => {
      console.log('📱 Dispositivo desconectado');
      window.location.reload();
    });

    return () => {socket.disconnect();}
  }, []);

  // Gerar link do Google Maps para o aparelho ativo
  const generateCurrentLocationLink = () => {
    if (devices.length === 0) return null;
    
    const activeDevice = devices.find(d => d.positions.length > 0);
    if (!activeDevice) return null;
    
    const lastPosition = activeDevice.positions[activeDevice.positions.length - 1];
    return {
      link: `https://www.google.com/maps?q=${lastPosition.lat},${lastPosition.lng}&t=m&z=15`,
      deviceName: activeDevice.name,
      timestamp: lastPosition.timestamp
    };
  };

  const currentLocationData = generateCurrentLocationLink();

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      <TrackingMap devices={devices} center={center} />
      
      {/* Quadro flutuante com link do Google Maps */}
      {currentLocationData && (
        <div style={{
          position: "absolute",
          top: "20px",
          right: "20px",
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          border: "2px solid #4285f4",
          borderRadius: "30px",
          padding: "12px 16px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          minWidth: "200px",
          cursor: "pointer",
          transition: "all 0.2s ease",
          zIndex: 1000
        }}
        onClick={() => window.open(currentLocationData.link, '_blank')}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.02)";
          e.currentTarget.style.boxShadow = "0 6px 16px rgba(0,0,0,0.2)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
        }}
        >
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "6px"
          }}>
            <span style={{ fontSize: "18px" }}>🗺️</span>
            <span style={{ 
              fontWeight: "bold", 
              fontSize: "14px",
              color: "#1976d2"
            }}>
              Ver no Google Maps
            </span>
          </div>
          
          <div style={{
            fontSize: "12px",
            color: "#666",
            marginBottom: "4px"
          }}>
            📱 {currentLocationData.deviceName}
          </div>
          
          <div style={{
            fontSize: "11px",
            color: "#888"
          }}>
            🕐 {new Date(currentLocationData.timestamp).toLocaleTimeString()}
          </div>
          
          <div style={{
            fontSize: "10px",
            color: "#4285f4",
            marginTop: "6px",
            textAlign: "center",
            fontWeight: "500"
          }}>
            Clique para abrir
          </div>
        </div>
      )}
      
      {/* Painel de Logs de Desconexão */}
      <div style={{ 
        position: "absolute",
        top: "20px",
        right: "250px",
        width: "300px",
        maxHeight: "400px",
        backgroundColor: "rgba(245, 245, 245, 0.95)",
        color: '#000000', 
        padding: "15px",
        overflowY: "auto",
        borderRadius: '15px',
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 999
      }}>
        <h3 style={{ margin: "0 0 15px 0", fontSize: "16px" }}>⚠️ Logs de Desconexão</h3>
        
        {disconnectionLogs.map((log, index) => (
          <div key={index} style={{
            backgroundColor: "#ffebee",
            border: "1px solid #ffcdd2",
            borderRadius: "4px",
            padding: "8px",
            marginBottom: "8px",
            fontSize: "11px"
          }}>
            <div style={{ fontWeight: "bold", marginBottom: "4px", color: "#d32f2f" }}>
              🔴 DESCONECTADO - {new Date(log.timestamp).toLocaleTimeString()}
            </div>
            <div style={{ marginBottom: "4px", fontSize: "10px" }}>
              📱 {log.deviceName}
            </div>
            <div style={{ marginBottom: "6px", fontSize: "10px", color: "#666" }}>
              📍 {log.position.lat.toFixed(4)}, {log.position.lng.toFixed(4)}
            </div>
            <a 
              href={log.googleMapsLink} 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ 
                color: "#1976d2", 
                textDecoration: "none",
                fontSize: "10px",
                fontWeight: "bold"
              }}
            >
              🗺️ Ver última posição no Google Maps
            </a>
          </div>
        ))}
        
        {disconnectionLogs.length === 0 && (
          <div style={{ 
            textAlign: "center", 
            color: "#666", 
            fontSize: "12px",
            marginTop: "20px"
          }}>
            Nenhuma desconexão registrada
          </div>
        )}
      </div>
      </div>
  );
}
