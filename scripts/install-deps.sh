#!/bin/bash

echo "🔧 Installing system dependencies..."

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "📦 Installing dependencies for Linux..."
    
    # Update package list
    sudo apt update
    
    # Install required packages
    sudo apt install -y \
        python3 \
        python3-pip \
        ffmpeg \
        chromium-browser \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libdrm2 \
        libxss1 \
        libgtk-3-0 \
        ca-certificates
        
    # Install yt-dlp
    pip3 install --upgrade yt-dlp
    
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "📦 Installing dependencies for macOS..."
    
    # Check if Homebrew is installed
    if ! command -v brew &> /dev/null; then
        echo "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    
    # Install packages
    brew install python3 ffmpeg
    pip3 install --upgrade yt-dlp
    
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    echo "📦 Installing dependencies for Windows..."
    echo "Please install the following manually:"
    echo "1. Python 3: https://www.python.org/downloads/"
    echo "2. FFmpeg: https://ffmpeg.org/download.html"
    echo "3. Then run: pip install --upgrade yt-dlp"
    
else
    echo "❌ Unsupported operating system: $OSTYPE"
    echo "Please install Python3, FFmpeg, and yt-dlp manually"
    exit 1
fi

echo "✅ System dependencies installed successfully!"