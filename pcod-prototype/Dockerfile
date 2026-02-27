FROM node:18-slim
WORKDIR /app
COPY package.json package.json
RUN npm install --production
COPY . .
EXPOSE 4000
CMD ["node", "server.js"]
