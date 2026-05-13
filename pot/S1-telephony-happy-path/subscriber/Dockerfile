# S1 PoT — minimal ARI WS subscriber. Node 22 gives us WebSocket as a
# global, so no npm install / package.json deps required.
FROM node:22-slim
WORKDIR /app
COPY index.js .
ENV NODE_ENV=production
CMD ["node", "index.js"]
