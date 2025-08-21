# Deploy EasyPanel

## 1. Preparar Repositório Git

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/postalllog/rastreamento-adidas.git
git push -u origin main
```

## 2. No EasyPanel

1. **Criar Nova Aplicação:**
   - Tipo: "Node.js"
   - Repositório: Seu GitHub repo
   - Branch: main

2. **Configurar Build:**
   - Build Command: `npm run build`
   - Start Command: `sh -c "npm run server & npm start"`
   - Port: 3000

3. **Variáveis de Ambiente:**
   - `NODE_ENV=production`
   - `PORT=3001`

4. **Domínios:**
   - Adicionar seu domínio
   - Configurar SSL automático

## 3. Configurações de Rede

- **Frontend:** Porta 3000
- **WebSocket:** Porta 3001
- **Ambos:** HTTP/HTTPS

## 4. Atualizar URLs no Código

Substitua no `page.tsx`:
```javascript
const socket = io("https://seudominio.com:3001");
```

## 5. Deploy

- Push para GitHub
- EasyPanel fará deploy automático
- Acesse: https://seudominio.com