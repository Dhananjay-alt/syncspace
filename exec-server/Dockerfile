FROM node:20-slim

# Install Docker CLI so dockerode can talk to a Docker daemon.
RUN apt-get update && apt-get install -y \
    docker.io \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install npm deps (production only)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy everything else
COPY . .

EXPOSE 4000

# Build sandbox image on startup, then run server.
# First boot ~30s slower; subsequent boots cache layers.
CMD ["sh", "-c", "docker build -t nebula-python-sandbox:latest -f docker/python.Dockerfile docker/ && npx tsx src/server.ts"]