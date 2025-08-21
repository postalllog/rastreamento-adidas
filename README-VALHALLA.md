# Configuração Valhalla

## Pré-requisitos
- Docker instalado
- Docker Compose instalado

## Configuração Inicial

1. Execute o script de configuração:
```bash
setup-valhalla.bat
```

2. Ou use Docker Compose:
```bash
docker-compose up -d valhalla
```

## Uso Diário

Para iniciar o Valhalla:
```bash
start-valhalla.bat
```

## Endpoints

- Status: http://localhost:8002/status
- Roteamento: http://localhost:8002/route (POST)

## Exemplo de Requisição

```json
{
  "locations": [
    {"lat": -23.5505, "lon": -46.6333},
    {"lat": -23.5629, "lon": -46.6544}
  ],
  "costing": "auto"
}
```

## Parar o Serviço

```bash
docker-compose down
```