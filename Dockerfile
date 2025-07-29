FROM node:20-alpine AS development

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY global-bundle.pem ./global-bundle.pem
COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:prod"]