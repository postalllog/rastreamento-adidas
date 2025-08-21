# Deploy para Hostinger

## Opção 1: Hospedagem Estática (Mais Simples)

1. **Build do projeto:**
   ```bash
   cd rastreamento-adidas
   npm run build
   npm run export
   ```

2. **Upload:**
   - Compacte a pasta `out/`
   - Faça upload via File Manager da Hostinger
   - Extraia na pasta `public_html`

## Opção 2: VPS com Node.js

1. **Preparar arquivos:**
   ```bash
   npm run build
   ```

2. **Upload via FTP:**
   - Toda a pasta `rastreamento-adidas/`
   - Instalar dependências no servidor:
   ```bash
   npm install --production
   ```

3. **Iniciar serviços:**
   ```bash
   # WebSocket Server
   npm run server &
   
   # Next.js App  
   npm start
   ```

## Opção 3: Usar Vercel (Recomendado)

1. **Conectar ao GitHub:**
   - Suba o código para GitHub
   - Conecte no Vercel.com
   - Deploy automático

2. **WebSocket separado:**
   - Use Railway.app ou Render.com para o server.mjs
   - Atualize a URL no código

## Configurações Importantes

- **Domínio:** Substitua 'seudominio.com' pela URL real
- **CORS:** Ajuste as origens permitidas
- **Portas:** Hostinger usa portas específicas
- **SSL:** Configure HTTPS obrigatório