FROM node:22-bookworm-slim

WORKDIR /app

COPY . .

RUN npm ci
RUN npm run build -w @english/web

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

EXPOSE 8080

CMD ["npm", "run", "start", "-w", "@english/web", "--", "--hostname", "0.0.0.0", "--port", "8080"]
