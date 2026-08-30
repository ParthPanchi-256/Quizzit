FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install

# The actual source code will be mounted as a volume in development, 
# but copying it here ensures the image works standalone for production later.
COPY . .

# Expose port and run dev server
EXPOSE 5000
CMD ["npm", "run", "dev"]
