#!/bin/bash

echo "🚀 Deploying YouTube Downloader Service..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please run 'npm run setup' first."
    exit 1
fi

echo "Choose deployment platform:"
echo "1) Railway (Recommended - $5/month)"
echo "2) Heroku (Classic - $7/month)"
echo "3) DigitalOcean App Platform ($5/month)"
echo "4) Render (Free tier available)"
echo "5) Docker (Local/VPS)"

read -p "Enter choice (1-5): " choice

case $choice in
    1)
        echo "🚂 Deploying to Railway..."
        if ! command -v railway &> /dev/null; then
            npm install -g @railway/cli
        fi
        railway login
        railway up
        ;;
    2)
        echo "🟣 Deploying to Heroku..."
        if ! command -v heroku &> /dev/null; then
            echo "❌ Heroku CLI not installed. Install from: https://devcenter.heroku.com/articles/heroku-cli"
            exit 1
        fi
        
        heroku create youtube-downloader-$(date +%s)
        heroku buildpacks:add heroku/nodejs
        heroku buildpacks:add heroku/python
        
        # Set environment variables
        heroku config:set NODE_ENV=production
        heroku config:set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
        
        git add .
        git commit -m "Deploy to Heroku"
        git push heroku main
        ;;
    3)
        echo "🌊 DigitalOcean App Platform deployment..."
        echo "Please follow these steps:"
        echo "1. Go to https://cloud.digitalocean.com/apps"
        echo "2. Create new app from GitHub"
        echo "3. Select this repository"
        echo "4. Use the provided app.yaml configuration"
        ;;
    4)
        echo "🎨 Render deployment..."
        echo "Please follow these steps:"
        echo "1. Go to https://dashboard.render.com"
        echo "2. Connect your GitHub repository"
        echo "3. Create new Web Service"
        echo "4. Use provided render.yaml configuration"
        ;;
    5)
        echo "🐳 Building Docker image..."
        docker-compose build
        docker-compose up -d
        echo "✅ Service running on http://localhost:3000"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "✅ Deployment initiated!"
echo "🔗 Don't forget to:"
echo "1. Set up residential proxies in your environment variables"
echo "2. Test the API endpoints"
echo "3. Configure monitoring and alerts"