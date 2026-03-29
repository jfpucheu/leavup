FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY src/ src/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
EXPOSE 3000
CMD ["./entrypoint.sh"]
