FROM node:18-alpine

WORKDIR /app

# Copiar package.json
COPY rastreamento-adidas/package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código
COPY rastreamento-adidas/ ./

# Build da aplicação
RUN npm run build

# Expor portas
EXPOSE 3000 3001

# Comando para iniciar ambos os serviços
CMD ["sh", "-c", "npm run server & npm start"]