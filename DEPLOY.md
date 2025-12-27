# Деплой Bomberman на Railway через API

Полная инструкция по деплою игры без веб-интерфейса - только командная строка!

## Требования

- GitHub аккаунт
- Railway аккаунт (https://railway.app)
- `gh` CLI (GitHub CLI)
- `curl`

## Шаг 1: Создать GitHub репозиторий

```bash
# Перейти в папку с игрой
cd /path/to/game

# Инициализировать git
git init

# Создать .gitignore
echo "node_modules/
*.log
.DS_Store" > .gitignore

# Добавить файлы и сделать коммит
git add -A
git commit -m "Initial commit: Bomberman online multiplayer"

# Создать репо на GitHub и запушить (замени USERNAME на свой)
gh repo create USERNAME/bomberman-online --public --source=. --push
```

## Шаг 2: Получить Railway API Token

1. Открой https://railway.app/account/tokens
2. Нажми "Create Token"
3. Скопируй токен

```bash
# Сохрани токен в переменную (замени на свой токен)
export RAILWAY_TOKEN="твой-токен-здесь"
```

## Шаг 3: Создать проект на Railway

```bash
# Создать проект
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { projectCreate(input: { name: \"bomberman-online\" }) { id name } }"
  }'
```

Сохрани `id` проекта из ответа:
```bash
export PROJECT_ID="id-из-ответа"
```

## Шаг 4: Получить Environment ID

```bash
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"query { project(id: \\\"$PROJECT_ID\\\") { environments { edges { node { id name } } } } }\"
  }"
```

Сохрани `id` environment (обычно "production"):
```bash
export ENV_ID="id-environment"
```

## Шаг 5: Создать сервис

```bash
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { serviceCreate(input: { projectId: \"'$PROJECT_ID'\", name: \"app\" }) { id name } }"
  }'
```

Сохрани `id` сервиса:
```bash
export SERVICE_ID="id-сервиса"
```

## Шаг 6: Подключить GitHub репозиторий

```bash
# Замени USERNAME/bomberman-online на свой репо
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { serviceConnect(id: \"'$SERVICE_ID'\", input: { repo: \"USERNAME/bomberman-online\", branch: \"master\" }) { id } }"
  }'
```

## Шаг 7: Создать домен

```bash
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { serviceDomainCreate(input: { serviceId: \"'$SERVICE_ID'\", environmentId: \"'$ENV_ID'\" }) { domain } }"
  }'
```

**Готово!** В ответе будет твой URL типа `xxx-production-xxxx.up.railway.app`

## Шаг 8: Запустить деплой

```bash
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { serviceInstanceRedeploy(serviceId: \"'$SERVICE_ID'\", environmentId: \"'$ENV_ID'\") }"
  }'
```

## Шаг 9: Проверить статус

```bash
# Подожди 1-2 минуты и проверь
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { deployments(first: 1, input: { projectId: \"'$PROJECT_ID'\" }) { edges { node { status } } } }"
  }'
```

Когда `status` станет `SUCCESS` - игра готова!

---

## Быстрый скрипт (всё в одном)

Создай файл `deploy.sh`:

```bash
#!/bin/bash

# === НАСТРОЙКИ ===
RAILWAY_TOKEN="твой-токен"
GITHUB_REPO="USERNAME/bomberman-online"
PROJECT_NAME="bomberman-online"

# === ДЕПЛОЙ ===
echo "🚀 Создаю проект..."
PROJECT_ID=$(curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { projectCreate(input: { name: \"'$PROJECT_NAME'\" }) { id } }"}' \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "📦 Project ID: $PROJECT_ID"

echo "🔍 Получаю environment..."
ENV_ID=$(curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "query { project(id: \"'$PROJECT_ID'\") { environments { edges { node { id } } } } }"}' \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "🌍 Environment ID: $ENV_ID"

echo "⚙️ Создаю сервис..."
SERVICE_ID=$(curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { serviceCreate(input: { projectId: \"'$PROJECT_ID'\", name: \"app\" }) { id } }"}' \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "🔧 Service ID: $SERVICE_ID"

echo "🔗 Подключаю GitHub..."
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { serviceConnect(id: \"'$SERVICE_ID'\", input: { repo: \"'$GITHUB_REPO'\", branch: \"master\" }) { id } }"}' > /dev/null

echo "🌐 Создаю домен..."
DOMAIN=$(curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { serviceDomainCreate(input: { serviceId: \"'$SERVICE_ID'\", environmentId: \"'$ENV_ID'\" }) { domain } }"}' \
  | grep -o '"domain":"[^"]*"' | cut -d'"' -f4)

echo "🚀 Запускаю деплой..."
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { serviceInstanceRedeploy(serviceId: \"'$SERVICE_ID'\", environmentId: \"'$ENV_ID'\") }"}' > /dev/null

echo ""
echo "✅ ГОТОВО!"
echo "🎮 Твоя игра: https://$DOMAIN"
echo ""
echo "⏳ Подожди 1-2 минуты пока соберётся..."
```

Запусти:
```bash
chmod +x deploy.sh
./deploy.sh
```

---

## Важно для package.json

Убедись что в `package.json` есть:

```json
{
  "scripts": {
    "start": "node server.js"
  }
}
```

И в `server.js`:

```javascript
const PORT = process.env.PORT || 3456;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
```

---

## Полезные команды

### Проверить все проекты
```bash
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "query { projects { edges { node { id name } } } }"}'
```

### Удалить проект
```bash
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { projectDelete(id: \"PROJECT_ID\") }"}'
```

### Посмотреть логи деплоя
```bash
curl -s "https://backboard.railway.app/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "query { deployments(first: 5, input: { projectId: \"'$PROJECT_ID'\" }) { edges { node { id status createdAt } } } }"}'
```

---

## Автодеплой

После настройки, каждый `git push` в репозиторий автоматически запускает новый деплой на Railway!

```bash
git add .
git commit -m "Update game"
git push
# Railway автоматически передеплоит!
```
