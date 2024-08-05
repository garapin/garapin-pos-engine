# Dockerfile
FROM node:14

WORKDIR /src

COPY package*.json ./
RUN npm install

COPY . .

# Install nodemon globally
RUN npm install -g nodemon

# Copy .env file
COPY .env-sample .env

EXPOSE 8080
CMD ["nodemon", "app.js"]