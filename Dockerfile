FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && cp -r node_modules /opt-node-modules
COPY src ./src
# dev-mode bind-mounts the checked-out repo over /app, which would shadow /app/node_modules
ENV NODE_PATH=/opt-node-modules
EXPOSE 4003
CMD ["npm", "start"]
