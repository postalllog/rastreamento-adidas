@echo off
echo Baixando dados do Sudeste do Brasil...
curl -o sudeste.osm.pbf "http://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf"

echo Processando dados...
docker run -t -v "%cd%":/data osrm/osrm-backend osrm-extract -p /opt/car.lua /data/sudeste.osm.pbf
docker run -t -v "%cd%":/data osrm/osrm-backend osrm-partition /data/sudeste.osrm
docker run -t -v "%cd%":/data osrm/osrm-backend osrm-customize /data/sudeste.osrm

echo Iniciando servidor OSRM...
docker run -d --name osrm -p 5000:5000 -v "%cd%":/data osrm/osrm-backend osrm-routed --algorithm mld /data/sudeste.osrm

echo OSRM rodando na porta 5000
pause