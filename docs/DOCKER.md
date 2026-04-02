# Docker Deployment Guide

Complete guide for deploying Skynul Backend using Docker and Docker Compose.

## Quick Start

```bash
# 1. Clone and enter directory
git clone <repo-url>
cd skynul-backend

# 2. Copy environment file
cp .env.example .env
# Edit .env and add your API keys

# 3. Start with docker-compose
docker-compose up -d

# 4. Check status
docker-compose ps
docker-compose logs -f skynul
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Required
PORT=3141
JWT_SECRET=your-secret-key
OPENAI_API_KEY=your-openai-key

# Optional
SKYNUL_LOG_LEVEL=info
SKYNUL_STREAMING=true
REDIS_URL=redis://redis:6379
```

### Docker Compose Services

- **skynul** - Main backend API (port 3141)
- **redis** - Caching and task queue (port 6379)
- **nginx** - Reverse proxy (optional, commented out)

## Build & Run

### Production Build

```bash
# Build image
docker build -t skynul-backend:latest .

# Run container
docker run -d \
  --name skynul \
  -p 3141:3141 \
  --env-file .env \
  -v skynul-data:/app/data \
  skynul-backend:latest

# Check logs
docker logs -f skynul
```

### Development Mode

```bash
# Start with hot reload (mount source code)
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

## Health Checks

The container includes automatic health checks:

```bash
# Check container health
docker ps

# Health check runs every 30s on /health endpoint
# Unhealthy containers are auto-restarted
```

## Data Persistence

Data is stored in Docker volumes:

- `skynul-data` - SQLite database, memory.db
- `skynul-logs` - Application logs
- `redis-data` - Redis cache

```bash
# Backup data
docker run --rm -v skynul-data:/data -v $(pwd):/backup alpine tar czf /backup/backup.tar.gz -C /data .

# Restore data
docker run --rm -v skynul-data:/data -v $(pwd):/backup alpine tar xzf /backup/backup.tar.gz -C /data
```

## Updates

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose down
docker-compose up -d --build

# Check new version
docker-compose logs skynul | head -20
```

## Security

### Non-root User

The container runs as `skynul` user (UID 1001) for security.

### Secrets Management

Never commit `.env` file. For production:

```bash
# Use Docker secrets (Swarm mode)
echo "your-secret" | docker secret create jwt_secret -

# Or use environment file
docker run --env-file .env skynul-backend
```

### Network Security

```bash
# View network
docker network ls
docker network inspect skynul-network

# Only expose necessary ports
# - 3141: API
# - Do NOT expose Redis (internal only)
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs skynul

# Check env variables
docker-compose exec skynul env | grep SKYNUL

# Test config
docker-compose exec skynul node -e "console.log('Config OK')"
```

### Database issues

```bash
# Check database
docker-compose exec skynul ls -la /app/data/

# Fix permissions
sudo chown -R 1001:1001 ./data

# Reset database (WARNING: deletes all data!)
docker-compose down -v
```

### Performance

```bash
# Monitor resources
docker stats

# Check memory
docker-compose exec skynul ps aux

# Optimize: Reduce memory limit if needed
# Edit docker-compose.yml resources section
```

## Production Deployment

### With SSL (Let's Encrypt)

1. Uncomment nginx service in docker-compose.yml
2. Add SSL certificates to `./nginx/ssl/`
3. Update nginx.conf
4. Run: `docker-compose up -d`

### With Reverse Proxy (Traefik)

```yaml
# Add to docker-compose.yml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.skynul.rule=Host(`api.yourdomain.com`)"
  - "traefik.http.routers.skynul.tls.certresolver=letsencrypt"
```

### Scaling

```bash
# Scale horizontally
docker-compose up -d --scale skynul=3

# Use external load balancer
# Or use Docker Swarm mode
```

## Image Size

Current image size: ~180MB (compressed)

Components:
- Node.js 20 Alpine: ~50MB
- Dependencies: ~100MB
- Application: ~30MB

To reduce size further:
```bash
# Use multi-stage build (already implemented)
# Minimize layers in Dockerfile
# Use .dockerignore effectively
```

## Maintenance

### Daily

```bash
# Check health
docker-compose ps
docker-compose logs --tail=100 skynul
```

### Weekly

```bash
# Update images
docker-compose pull
docker-compose up -d

# Cleanup
docker system prune -f
```

### Monthly

```bash
# Backup data
docker run --rm -v skynul-data:/data alpine tar czf backup-$(date +%Y%m%d).tar.gz -C /data .

# Review logs
docker-compose logs --since=30d skynul > monthly-logs.txt
```

## Support

- **Health endpoint:** http://localhost:3141/health
- **Logs:** `docker-compose logs -f skynul`
- **Shell:** `docker-compose exec skynul sh`
