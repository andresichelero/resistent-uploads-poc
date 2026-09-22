FROM node:24.14.0-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["npm", "start"]
