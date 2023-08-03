FROM node:18
WORKDIR /app
COPY package.json .
COPY package-lock.json .
RUN npm install
COPY . .
EXPOSE 8080
CMD [ "node", "ueberwachung-edge docker.js" ]
