#!/bin/bash

echo "🚀 Setting up YouTube Downloader Service..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 is not installed. Please install Python3 first."
    exit 1
fi

# Install yt-dlp
echo "📦 Installing yt-dlp..."
pip3 install --upgrade yt-dlp

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "⚠️ FFmpeg is not installed. Installing..."
    
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt update && sudo apt install -y ffmpeg
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew install ffmpeg
    else
        echo "❌ Please install FFmpeg manually for your operating system"
        exit 1
    fi
fi

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Create directories
echo "📁 Creating directories..."
mkdir -p downloads temp logs

# Copy environment template
if [ ! -f .env ]; then
    echo "📄 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️ Please edit .env file and add your proxy configuration!"
fi

echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Edit .env file and add your residential proxy details"
echo "2. Run 'npm start' to start the service"
echo "3. Test with 'npm test'"
echo ""
echo "🌐 For deployment:"
echo "- Docker: docker-compose up -d"
echo "- Cloud: npm run deploy"