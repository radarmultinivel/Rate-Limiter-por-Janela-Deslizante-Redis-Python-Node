# Rate Limiter por Janela Deslizante com Redis

Middleware de controle de taxa de requisições (rate limiter) para Node.js com TypeScript, implementando o algoritmo Sliding Window Log sobre Redis com script Lua atômico, anonimizacao de IPs via HMAC-SHA256 e injecao de headers padrao de mercado.

---

## Objetivo do Programa

Prover uma camada de seguranca reutilizavel para gateways de API que bloqueie requisicoes abusivas ou maliciosas baseando-se no endereco IP do cliente. O sistema implementa o algoritmo Sliding Window Log utilizando Redis como armazenamento em memoria para garantir atomicidade, precisao milimetrica de janela temporal e eliminacao dos picos de borda caracteristicos do algoritmo de Janela Fixa (Fixed Window).

---

## Requisitos

### Funcionais

- Bloquear requisicoes que excedam o limite configurado por IP em uma janela temporal deslizante
- Retornar HTTP 429 Too Many Requests com corpo JSON explicativo quando o limite for excedido
- Injetar os headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
- Permitir configuracao de limites diferentes por rota (ex: 5 req/min para login, 100 req/min para API geral)
- Anonimizar os IPs armazenados no Redis via HMAC-SHA256 com chave secreta (LGPD)
- Operar de forma atomica via script Lua no Redis para eliminar condicoes de corrida
- Suportar fail-open: se o Redis falhar, a requisicao e permitida e um aviso e registrado

### Nao Funcionais

- Latencia maxima por requisicao: < 50ms com Redis local
- Linguagem: Node.js 20+ com TypeScript 5+
- Banco de dados: Redis 7
- Framework HTTP: Express 4.x
- Testes automatizados com Vitest

---

## Especificacoes Tecnicas

### Arquitetura

```
                          +------------------+
                          |   Cliente HTTP   |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |   Express App    |
                          |  (server.ts)     |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |  rateLimit.ts    |
                          |  (Middleware)    |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |  limiter.ts      |
                          |  (SlidingWindow  |
                          |   Log Logic)     |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |  hasher.ts       |
                          |  (HMAC SHA-256   |
                          |   IP Hash)       |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |  redis.ts        |
                          |  (ioredis Pool)  |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |     Redis 7      |
                          |  (Sorted Set)    |
                          +------------------+
```

### Fluxograma do Algoritmo

```
Chegada da requisicao
         |
         v
Extrair IP do cliente (x-forwarded-for / remoteAddress)
         |
         v
Aplicar HMAC-SHA256 no IP -> hash
         |
         v
Executar script Lua atomico no Redis:
         |
         +---> ZREMRANGEBYSCORE (limpar registros expirados)
         |
         +---> ZCARD (contar registros ativos)
         |
         +---> Se count >= maxRequests:
         |         retornar BLOQUEADO (allowed=0)
         |
         +---> Se count < maxRequests:
                   ZADD (registrar timestamp atual)
                   EXPIRE (definir TTL)
                   retornar PERMITIDO (allowed=1)
         |
         v
Se permitido: next() com headers X-RateLimit-*
Se bloqueado: res.status(429).json(...)
```

### Estrutura de Dados no Redis

```
Chave: rate_limit:<hash_do_ip>
Tipo:  Sorted Set (ZSET)

Membros:  timestamp_ms (string)
Scores:   timestamp_ms (number)

Exemplo:
  ZRANGE rate_limit:a1b2c3d4... 0 -1 WITHSCORES
  1) "1718123456789"
  2) "1718123456789"
  3) "1718123456799"
  4) "1718123456799"
```

### Script Lua Atomico

```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowSeconds = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local windowStart = now - windowSeconds * 1000

redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
local count = redis.call('ZCARD', key)

if count >= maxRequests then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local resetTimestamp = now + windowSeconds * 1000
    if #oldest >= 2 then
        resetTimestamp = tonumber(oldest[2]) + windowSeconds * 1000
    end
    return {0, count, resetTimestamp}
end

redis.call('ZADD', key, now, tostring(now))
redis.call('EXPIRE', key, windowSeconds + 1)

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetTimestamp = now + windowSeconds * 1000
if #oldest >= 2 then
    resetTimestamp = tonumber(oldest[2]) + windowSeconds * 1000
end

return {1, count + 1, resetTimestamp}
```

---

## Stacks e Tecnologias

| Componente | Tecnologia | Versao |
|---|---|---|
| Runtime | Node.js | 20+ |
| Linguagem | TypeScript | 5.4+ |
| Framework HTTP | Express | 4.18 |
| Cliente Redis | ioredis | 5.4 |
| Cache | Redis | 7 (Alpine) |
| Testes | Vitest | 1.6 |
| Execucao dev | tsx | 4.7 |
| Continer Redis | Docker Compose | 3.9 |

---

## Dependencias

### Producao

- `express` - Framework HTTP
- `ioredis` - Cliente Redis com suporte a transacoes e scripts Lua
- `dotenv` - Gerenciamento de variaveis de ambiente

### Desenvolvimento

- `typescript` - Compilador TS
- `tsx` - Execucao TypeScript no Node
- `vitest` - Framework de testes
- `@types/express` - Tipagens do Express
- `@types/node` - Tipagens do Node

---

## Instalacao

### Pre-requisitos

- Node.js 20 ou superior
- Docker e Docker Compose
- npm (incluido no Node.js)

### Passos

```bash
# 1. Clonar o repositorio
git clone https://github.com/L-A-Leandro/rate-limiter-sliding-window-log.git
cd rate-limiter-sliding-window-log

# 2. Instalar dependencias
npm install

# 3. Configurar ambiente
cp .env.example .env
# Editar .env com suas configuracoes

# 4. Iniciar Redis via Docker
docker compose up -d

# 5. Verificar Redis
docker compose ps

# 6. Iniciar servidor de desenvolvimento
npm run dev
```

A API estara disponivel em http://localhost:3000.

### Variaveis de Ambiente

| Variavel | Descricao | Padrao |
|---|---|---|
| REDIS_URL | URL de conexao com Redis | redis://localhost:6379 |
| RATE_LIMIT_SECRET | Chave secreta para HMAC de IPs | (obrigatorio em producao) |
| DEFAULT_WINDOW_SECONDS | Janela padrao em segundos | 60 |
| DEFAULT_MAX_REQUESTS | Limite maximo padrao de requisicoes | 10 |
| PORT | Porta do servidor HTTP | 3000 |

---

## Manual do Usuario

### Rotas da API

| Metodo | Rota | Rate Limit | Descricao |
|---|---|---|---|
| GET | /health | Nenhum | Health check |
| GET | /api/public | Nenhum | Rota publica sem limite |
| GET | /api/protected | 10 req/min | Rota protegida com rate limit |
| POST | /api/login | 5 req/min | Endpoint de login limitado |

### Testando com curl

```bash
# Health check
curl http://localhost:3000/health

# Rota publica
curl -i http://localhost:3000/api/public

# Rota protegida - fazer 15 requisicoes, 10 devem passar e 5 serem bloqueadas
for /L %i in (1,1,15) do curl -s -o NUL -w "%%{http_code}\n" http://localhost:3000/api/protected

# Endpoint de login
for /L %i in (1,1,7) do curl -s -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d "{\"username\":\"admin\"}" -w " HTTP %%{http_code}\n"
```

### Headers de Resposta

Quando uma requisicao e processada, os seguintes headers sao retornados:

- `X-RateLimit-Limit`: Limite maximo configurado
- `X-RateLimit-Remaining`: Requisicoes restantes na janela atual
- `X-RateLimit-Reset`: Timestamp Unix de quando o limite sera reiniciado

### Resposta de Bloqueio (HTTP 429)

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again after 45 seconds.",
  "retryAfter": 45
}
```

### Comandos Redis uteis

```bash
# Acessar CLI do Redis
docker exec -it rate-limiter-redis redis-cli

# Listar chaves de rate limit
KEYS rate_limit:*

# Ver registros de um IP
ZRANGE rate_limit:<hash> 0 -1 WITHSCORES

# Ver TTL de uma chave
TTL rate_limit:<hash>

# Ver quantidade de requisicoes ativas
ZCARD rate_limit:<hash>

# Limpar chave de um IP
DEL rate_limit:<hash>
```

---

## Testes

```bash
# Executar todos os testes
npm test

# Modo watch
npm run test:watch

# Testes com verbose
npm run test:stress
```

### Cobertura de Testes

1. **Permitir requisicoes dentro do limite**: 10 requisicoes para limite de 10, todas aprovadas
2. **Bloquear requisicoes que excedem o limite**: 15 requisicoes para limite de 10, exatas 10 aprovadas e 5 bloqueadas
3. **Contagem remaining correta**: Apos 1 requisicao, remaining = 4 (limite 5); apos 2, remaining = 3
4. **Reset timestamp futuro**: Timestamp de reset sempre maior que Date.now()
5. **IPs diferentes independentes**: IPs distintos tem contadores isolados
6. **Estresse concorrente**: 15 requisicoes paralelas via Promise.all, exatas 10 aprovadas e 5 bloqueadas
7. **Fail-open**: Quando Redis esta indisponivel, requisicao e permitida (allowed = true)
8. **HMAC deterministico**: Mesmo IP sempre produz o mesmo hash
9. **HMAC diferente para IPs diferentes**: IPs distintos produzem hashes distintos
10. **Formato do hash**: String hexadecimal de 64 caracteres

---

## Estrutura do Projeto

```
/
|-- docker-compose.yml       # Configuracao do container Redis
|-- package.json             # Dependencias e scripts
|-- tsconfig.json            # Configuracao TypeScript
|-- .env.example             # Template de variaveis de ambiente
|-- .gitignore               # Arquivos ignorados pelo git
|-- LICENSE                  # Licenca MIT
|-- README.md                # Esta documentacao
|-- src/
|   |-- config/
|   |   |-- redis.ts         # Pool de conexao ioredis
|   |-- security/
|   |   |-- hasher.ts        # HMAC-SHA256 para anonimizacao de IPs
|   |   |-- limiter.ts       # Logica Sliding Window Log com Lua script
|   |-- middleware/
|   |   |-- rateLimit.ts     # Middleware Express
|   |-- server.ts            # Servidor HTTP de testes
|-- tests/
|   |-- limiter.test.ts      # Suite de testes Vitest
```

---

## Seguranca e Privacidade (LGPD)

1. **Anonimizacao de IPs**: Todo IP e ofuscado via HMAC-SHA256 antes de ser armazenado no Redis. Administradores com acesso ao banco nao conseguem identificar usuarios reais.
2. **Chave secreta rotacionavel**: A variavel RATE_LIMIT_SECRET pode ser alterada periodicamente conforme politica de seguranca.
3. **Sem logs de IPs reais**: O middleware nunca registra IPs em texto plano - apenas hashes sao persistidos.

---

## Configuracao por Rota

```typescript
import { rateLimit } from "./middleware/rateLimit";

// Login: 5 tentativas por minuto
app.post("/api/login", rateLimit({ maxRequests: 5, windowSeconds: 60 }), handler);

// API geral: 100 requisicoes por minuto
app.get("/api/v1/*", rateLimit({ maxRequests: 100, windowSeconds: 60 }), handler);

// Endpoint critico: 2 requisicoes a cada 10 segundos
app.post("/api/payment", rateLimit({ maxRequests: 2, windowSeconds: 10 }), handler);
```

---

## Licenca

MIT License - Copyright (c) 2026 L. A. Leandro
