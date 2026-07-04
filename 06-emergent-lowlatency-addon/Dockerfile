# Standalone media-stream server (persistent WebSocket). Run OUTSIDE serverless.
FROM oven/bun:1
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY *.ts *.json ./
ENV MEDIA_STREAM_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD bun -e "fetch('http://localhost:3001/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["bun", "run", "media-stream-server.ts"]
