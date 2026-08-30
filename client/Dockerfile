FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Expose Vite's port. We must append --host to bind it to 0.0.0.0 in Docker
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
