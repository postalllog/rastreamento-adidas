@echo off
echo Iniciando Valhalla...
docker-compose up -d valhalla

echo Aguardando Valhalla inicializar...
timeout /t 10

echo Valhalla disponivel em: http://localhost:8002
echo Status: http://localhost:8002/status
pause