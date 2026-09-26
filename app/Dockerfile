# syntax=docker/dockerfile:1
FROM node:20.17.0-alpine3.20

WORKDIR /usr/src/app

# Install dependencies first so the layer is cached unless package files change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy only the application source needed at runtime
COPY src ./src

# Run as a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /usr/src/app
USER appuser

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(r.status!==200)process.exit(1);process.exit(0)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
