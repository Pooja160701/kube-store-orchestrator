# Use lightweight Node image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install only production deps
RUN npm install --production

# Copy source code
COPY src ./src

# Expose backend port
EXPOSE 3000

# Run app
CMD ["node", "src/index.js"]