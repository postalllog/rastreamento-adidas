FROM node:18-alpine

WORKDIR /app

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar todas as dependências (incluindo dev para build)
RUN npm ci

# Copiar código fonte
COPY . .

# Dar permissão de execução ao script
RUN chmod +x start.sh

# Build da aplicação Next.js
RUN npm run build

# Expor portas
EXPOSE 80 3001

# Comando para iniciar a aplicação
CMD ["./start.sh"]