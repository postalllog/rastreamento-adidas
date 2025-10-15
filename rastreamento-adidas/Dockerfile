FROM node:18-alpine

WORKDIR /app

# Copiar package.json do subdiretório (contexto é a raiz)
COPY rastreamento-adidas/package*.json ./

# Instalar dependências
RUN npm ci

# Copiar código do subdiretório
COPY rastreamento-adidas/ .

# Build
RUN npm run build

# Porta
EXPOSE 80

# Start
CMD ["node", "server-integrated.js"]