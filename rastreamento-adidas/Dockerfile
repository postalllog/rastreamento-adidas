FROM node:18-alpine

WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código fonte
COPY . .

# Build da aplicação Next.js
RUN npm run build

# Expor portas
EXPOSE 80 3001

# Comando para iniciar a aplicação
CMD ["npm", "start"]