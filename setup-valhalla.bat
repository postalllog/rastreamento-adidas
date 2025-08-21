@echo off
echo Configurando Valhalla...

echo Criando diretorio de dados...
mkdir valhalla_data 2>nul

echo Baixando dados do Brasil...
curl -o valhalla_data\brazil-latest.osm.pbf "http://download.geofabrik.de/south-america/brazil-latest.osm.pbf"

echo Iniciando Valhalla com Docker...
docker run -d --name valhalla -p 8002:8002 -v "%cd%\valhalla_data":/data gisops/valhalla:latest

echo Aguardando Valhalla processar dados (pode demorar alguns minutos)...
timeout /t 30

echo Valhalla rodando na porta 8002
echo Teste: http://localhost:8002/status
pause