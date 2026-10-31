# Baybex Restaurant SaaS — production image (Coolify: Build Pack = Dockerfile, Port = 3000)
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/setup/status || exit 1
CMD ["node", "server.js"]
