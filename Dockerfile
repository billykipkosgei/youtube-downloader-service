# Use Node.js directly instead of Ubuntu
FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxss1 \
    libxtst6 \
    libasound2 \
    libatspi2.0-0 \
    libgtk-3-0 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp in a virtual environment
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install --upgrade yt-dlp

# Add virtual environment to PATH
ENV PATH="/opt/venv/bin:$PATH"

# Create app directory
WORKDIR /app

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser \
    && mkdir -p downloads temp logs \
    && chown -R appuser:appuser /app

# Copy package files first (for better layer caching)
COPY package*.json ./

# Set Puppeteer to use system Chromium before npm install
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install dependencies with npm install instead of npm ci for better performance
RUN npm install --omit=dev

# Copy application code
COPY server.js ./
COPY scripts/ ./scripts/

# Set ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -q -O - http://localhost:3000/health || exit 1

# Start application
CMD ["npm", "start"]