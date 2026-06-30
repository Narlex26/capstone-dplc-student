# Stage 1 : build 
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# Stage 2 : image finale et légère 
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/main.js ./
COPY --from=builder /app/public ./public

RUN addgroup -S capstone && adduser -S capstone -G capstone
USER capstone

EXPOSE 3000

CMD ["node", "main.js"]