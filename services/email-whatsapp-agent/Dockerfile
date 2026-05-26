FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json eslint.config.js .prettierrc ./
COPY src ./src
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY .env.example ./.env.example
EXPOSE 3000
CMD ["npm", "run", "start"]
