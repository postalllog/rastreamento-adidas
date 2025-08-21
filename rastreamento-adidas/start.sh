#!/bin/bash
set -e

echo "🚀 Iniciando WebSocket server..."
node server.mjs &
WEBSOCKET_PID=$!

echo "🌐 Iniciando Next.js..."
next start -p ${PORT:-80} &
NEXTJS_PID=$!

echo "✅ Ambos os serviços iniciados"
echo "WebSocket PID: $WEBSOCKET_PID"
echo "Next.js PID: $NEXTJS_PID"

# Aguardar ambos os processos
wait $WEBSOCKET_PID $NEXTJS_PID