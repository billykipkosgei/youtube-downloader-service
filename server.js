const express = require('express');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Puppeteer with stealth plugin
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Enhanced configuration
const CONFIG = {
    port: process.env.PORT || 3000,
    downloadDir: process.env.DOWNLOAD_DIR || './downloads',
    tempDir: process.env.TEMP_DIR || './temp',
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 2,
    requestDelay: parseInt(process.env.REQUEST_DELAY) || 8000,
    sessionDelay: parseInt(process.env.SESSION_DELAY) || 30000,
    fileRetentionHours: parseInt(process.env.FILE_RETENTION_HOURS) || 12,
    
    // Proxy configuration (ESSENTIAL for production)
    proxies: process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : [],
    
    // Enhanced user agent rotation
    userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebLib/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
    
    viewports: [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1440, height: 900 },
        { width: 1536, height: 864 }
    ],
    
    timezones: [
        'America/New_York',
        'America/Los_Angeles',
        'America/Chicago',
        'Europe/London',
        'Europe/Berlin'
    ],
    
    languages: [
        'en-US,en;q=0.9',
        'en-US,en;q=0.9,es;q=0.8',
        'en-GB,en;q=0.9',
        'en-US,en;q=0.9,fr;q=0.8'
    ]
};

// In-memory storage
const jobs = new Map();
const activeDownloads = new Set();
const lastRequestTime = new Map();
const sessions = new Map();

// Utility functions
const generateJobId = () => crypto.randomUUID();
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomElement = (array) => array[Math.floor(Math.random() * array.length)];
const getRandomUserAgent = () => getRandomElement(CONFIG.userAgents);
const getRandomViewport = () => getRandomElement(CONFIG.viewports);
const getRandomTimezone = () => getRandomElement(CONFIG.timezones);
const getRandomLanguage = () => getRandomElement(CONFIG.languages);
const getRandomProxy = () => CONFIG.proxies.length > 0 ? getRandomElement(CONFIG.proxies) : null;

// Rate limiting check
const checkRateLimit = (sessionId) => {
    const lastRequest = lastRequestTime.get(sessionId);
    const now = Date.now();
    
    if (lastRequest && (now - lastRequest) < CONFIG.sessionDelay) {
        return false;
    }
    
    lastRequestTime.set(sessionId, now);
    return true;
};

// Initialize directories
async function initDirectories() {
    try {
        await fs.mkdir(CONFIG.downloadDir, { recursive: true });
        await fs.mkdir(CONFIG.tempDir, { recursive: true });
        await fs.mkdir('./logs', { recursive: true });
        console.log('📁 Directories initialized');
    } catch (error) {
        console.error('❌ Error creating directories:', error);
    }
}

// Clean old files
async function cleanOldFiles() {
    try {
        const files = await fs.readdir(CONFIG.downloadDir);
        const now = Date.now();
        const maxAge = CONFIG.fileRetentionHours * 60 * 60 * 1000;
        let cleanedCount = 0;

        for (const file of files) {
            const filePath = path.join(CONFIG.downloadDir, file);
            const stats = await fs.stat(filePath);
            
            if (now - stats.mtime.getTime() > maxAge) {
                await fs.unlink(filePath);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned ${cleanedCount} old files`);
        }
    } catch (error) {
        console.error('❌ Error cleaning old files:', error);
    }
}

// YouTube URL validation
function validateYouTubeUrl(url) {
    const patterns = [
        /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+(&.*)?$/,
        /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+(\?.*)?$/,
        /^https?:\/\/(www\.)?youtube\.com\/v\/[\w-]+(\?.*)?$/
    ];
    
    return patterns.some(pattern => pattern.test(url));
}

// Create stealth browser session
async function createStealthBrowser(sessionId) {
    const proxy = getRandomProxy();
    const userAgent = getRandomUserAgent();
    const viewport = getRandomViewport();
    const timezone = getRandomTimezone();
    const language = getRandomLanguage();
    
    console.log(`🕵️ Creating stealth session: ${sessionId.slice(0, 8)}...`);
    
    const browserOptions = {
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-features=VizDisplayCompositor',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-default-apps',
            '--mute-audio',
            '--no-pings',
            '--disable-logging',
            `--user-agent=${userAgent}`,
            `--lang=${language.split(',')[0]}`,
            '--accept-language=' + language
        ]
    };

    if (proxy) {
        browserOptions.args.push(`--proxy-server=${proxy}`);
        console.log(`🌐 Using proxy: ${proxy.includes('@') ? proxy.split('@')[1] : proxy}`);
    }

    const browser = await puppeteer.launch(browserOptions);
    const page = await browser.newPage();
    
    await page.setUserAgent(userAgent);
    await page.setViewport(viewport);
    
    await page.setExtraHTTPHeaders({
        'Accept-Language': language,
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
    });

    // Override browser properties for stealth
    await page.evaluateOnNewDocument((timezone, language) => {
        Object.defineProperty(navigator, 'language', {
            get: () => language.split(',')[0]
        });
        
        Object.defineProperty(navigator, 'languages', {
            get: () => language.split(',').map(l => l.split(';')[0])
        });
    }, timezone, language);

    sessions.set(sessionId, { browser, page, userAgent, proxy, createdAt: Date.now() });
    return { browser, page };
}

// Extract video info with realistic browser behavior
async function getVideoInfoWithBrowser(url, sessionId) {
    try {
        console.log(`📺 Extracting video info for: ${url.slice(0, 50)}...`);
        
        const { browser, page } = await createStealthBrowser(sessionId);
        
        // Navigate to YouTube homepage first (realistic behavior)
        console.log('🌐 Loading YouTube homepage...');
        await page.goto('https://www.youtube.com', { 
            waitUntil: 'networkidle0', 
            timeout: 30000 
        });
        
        // Random delay to simulate human behavior
        await delay(2000 + Math.random() * 3000);
        
        // Handle cookie consent if present
        try {
            await page.click('[aria-label*="Accept"], [aria-label*="accept"], button:contains("Accept")', { timeout: 5000 });
            await delay(1000);
        } catch (e) {
            // Cookie banner might not be present
        }
        
        // Navigate to target video
        console.log('🎯 Loading target video...');
        await page.goto(url, { 
            waitUntil: 'networkidle0', 
            timeout: 30000 
        });
        
        // Wait for video player
        await page.waitForSelector('#movie_player, #player', { timeout: 20000 });
        await delay(3000 + Math.random() * 2000);
        
        // Extract video information
        const videoInfo = await page.evaluate(() => {
            const title = document.querySelector('h1.title yt-formatted-string')?.textContent ||
                         document.querySelector('meta[property="og:title"]')?.content ||
                         document.querySelector('title')?.textContent?.replace(' - YouTube', '') ||
                         'Unknown Title';
                         
            const duration = document.querySelector('.ytp-time-duration')?.textContent ||
                           document.querySelector('meta[property="video:duration"]')?.content ||
                           'Unknown';
                           
            const views = document.querySelector('#info-strings yt-formatted-string')?.textContent ||
                         'Unknown';
                         
            return { 
                title: title.trim(), 
                duration, 
                views: views.trim(),
                extractedAt: new Date().toISOString()
            };
        });

        console.log(`✅ Video info extracted: ${videoInfo.title}`);
        
        // Keep session for potential reuse, auto-cleanup after 5 minutes
        setTimeout(() => {
            browser.close().catch(() => {});
            sessions.delete(sessionId);
        }, 300000);
        
        return videoInfo;
        
    } catch (error) {
        console.error('❌ Browser extraction failed:', error.message);
        throw new Error(`Browser extraction failed: ${error.message}`);
    }
}

// Enhanced yt-dlp download with maximum stealth
async function downloadWithYtDlp(url, jobId, formats, sessionId) {
    const userAgent = getRandomUserAgent();
    const proxy = getRandomProxy();
    const outputTemplate = path.join(CONFIG.downloadDir, `${jobId}_%(format_id)s.%(ext)s`);
    
    console.log(`⬇️ Starting yt-dlp download: ${jobId.slice(0, 8)}...`);
    
    const baseArgs = [
        '--no-warnings',
        '--no-cache-dir',
        '--user-agent', `"${userAgent}"`,
        '--referer', 'https://www.youtube.com/',
        '--add-header', `Accept-Language:${getRandomLanguage()}`,
        '--add-header', 'Accept-Encoding:gzip, deflate, br',
        '--add-header', 'Connection:keep-alive',
        '--cookies-from-browser', 'chrome',
        '--sleep-interval', '5',
        '--max-sleep-interval', '15',
        '--retries', '3',
        '--fragment-retries', '3',
        '--retry-sleep', 'exp=1:5',
        '-o', `"${outputTemplate}"`
    ];

    if (proxy) {
        baseArgs.push('--proxy', proxy);
    }

    const results = {};
    
    // Download video format
    if (formats.includes('video')) {
        console.log('📹 Downloading video...');
        try {
            const videoArgs = [...baseArgs, 
                '-f', 'best[ext=mp4][height<=1080]/best[ext=mp4]/best',
                '--embed-subs',
                `"${url}"`
            ];
            
            const videoCmd = `yt-dlp ${videoArgs.join(' ')}`;
            await execPromise(videoCmd);
            
            const videoFiles = await fs.readdir(CONFIG.downloadDir);
            const videoFile = videoFiles.find(f => f.startsWith(`${jobId}_`) && f.includes('.mp4'));
            if (videoFile) {
                results.video = `/files/${videoFile}`;
                console.log(`✅ Video downloaded: ${videoFile}`);
            }
        } catch (error) {
            console.error('❌ Video download failed:', error.message);
        }
        
        await delay(CONFIG.requestDelay + Math.random() * 5000);
    }

    // Download audio format
    if (formats.includes('audio')) {
        console.log('🎵 Extracting audio...');
        try {
            const audioArgs = [...baseArgs, 
                '-f', 'bestaudio[ext=m4a]/bestaudio',
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '192K',
                `"${url}"`
            ];
            
            const audioCmd = `yt-dlp ${audioArgs.join(' ')}`;
            await execPromise(audioCmd);
            
            const audioFiles = await fs.readdir(CONFIG.downloadDir);
            const audioFile = audioFiles.find(f => f.startsWith(`${jobId}_`) && (f.includes('.mp3') || f.includes('.m4a')));
            if (audioFile) {
                results.audio = `/files/${audioFile}`;
                console.log(`✅ Audio extracted: ${audioFile}`);
            }
        } catch (error) {
            console.error('❌ Audio extraction failed:', error.message);
        }
        
        await delay(CONFIG.requestDelay + Math.random() * 5000);
    }

    // Create silent video
    if (formats.includes('silent_video') && results.video) {
        console.log('🔇 Creating silent video...');
        try {
            const originalVideoPath = path.join(CONFIG.downloadDir, results.video.replace('/files/', ''));
            const silentVideoPath = path.join(CONFIG.downloadDir, `${jobId}_silent.mp4`);
            
            const ffmpegCmd = `ffmpeg -i "${originalVideoPath}" -an -c:v copy -avoid_negative_ts make_zero "${silentVideoPath}"`;
            await execPromise(ffmpegCmd);
            
            results.silent_video = `/files/${jobId}_silent.mp4`;
            console.log(`✅ Silent video created`);
        } catch (error) {
            console.error('❌ Silent video creation failed:', error.message);
        }
    }

    return results;
}

// Execute command with enhanced error handling
function execPromise(command) {
    return new Promise((resolve, reject) => {
        const maskedCommand = command.replace(/http:\/\/[^:]+:[^@]+@/g, 'http://***:***@');
        console.log(`🔧 Executing: ${maskedCommand.slice(0, 100)}...`);
        
        exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
            if (error) {
                if (stderr.includes('Sign in to confirm') || 
                    stderr.includes('bot') || 
                    error.message.includes('429') ||
                    error.message.includes('403')) {
                    reject(new Error(`YouTube bot detection triggered: ${error.message}`));
                } else {
                    reject(new Error(`Command failed: ${error.message}`));
                }
            } else {
                resolve(stdout);
            }
        });
    });
}

// Process download job
async function processDownloadJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;

    const sessionId = `session_${jobId}`;
    
    try {
        console.log(`🚀 Processing job: ${jobId.slice(0, 8)}...`);
        job.status = 'processing';
        job.progress = 10;
        activeDownloads.add(jobId);

        // Rate limiting check
        if (!checkRateLimit(sessionId)) {
            throw new Error('Rate limit exceeded - please try again later');
        }

        // URL validation
        if (!validateYouTubeUrl(job.url)) {
            throw new Error('Invalid YouTube URL format');
        }

        job.progress = 20;

        // Stealth delay
        const stealthDelay = 5000 + Math.random() * 10000;
        console.log(`⏳ Stealth delay: ${Math.round(stealthDelay/1000)}s`);
        await delay(stealthDelay);

        // Extract video info
        try {
            const videoInfo = await getVideoInfoWithBrowser(job.url, sessionId);
            job.videoInfo = videoInfo;
            job.progress = 40;
        } catch (error) {
            console.warn('⚠️ Video info extraction failed, continuing:', error.message);
            job.progress = 40;
        }

        await delay(3000 + Math.random() * 7000);

        // Download files
        job.progress = 50;
        const downloadResults = await downloadWithYtDlp(job.url, jobId, job.formats, sessionId);
        
        if (Object.keys(downloadResults).length === 0) {
            throw new Error('No files downloaded - possible bot detection');
        }
        
        job.files = downloadResults;
        job.progress = 90;

        // Complete job
        job.status = 'completed';
        job.progress = 100;
        job.completedAt = new Date().toISOString();

        console.log(`✅ Job completed: ${jobId.slice(0, 8)}... (${Object.keys(downloadResults).length} files)`);

    } catch (error) {
        job.status = 'failed';
        job.error = error.message;
        
        if (error.message.includes('bot detection') || 
            error.message.includes('Sign in to confirm') ||
            error.message.includes('429') ||
            error.message.includes('403')) {
            job.errorType = 'bot_detection';
            console.error(`🚫 Bot detection for job ${jobId.slice(0, 8)}...: ${error.message}`);
        } else {
            job.errorType = 'general_error';
            console.error(`❌ Job failed ${jobId.slice(0, 8)}...: ${error.message}`);
        }
    } finally {
        activeDownloads.delete(jobId);
        
        // Cleanup session
        const session = sessions.get(sessionId);
        if (session) {
            try {
                await session.browser.close();
            } catch (e) {}
            sessions.delete(sessionId);
        }
    }
}

// API Routes

// Health check with enhanced statistics
app.get('/health', (req, res) => {
    const totalJobs = jobs.size;
    const completedJobs = Array.from(jobs.values()).filter(j => j.status === 'completed').length;
    const failedJobs = Array.from(jobs.values()).filter(j => j.status === 'failed').length;
    const botDetectionCount = Array.from(jobs.values()).filter(j => j.errorType === 'bot_detection').length;
    
    res.json({ 
        status: 'healthy',
        service: 'YouTube Downloader Service',
        version: '1.0.0',
        activeJobs: activeDownloads.size,
        totalJobs,
        completedJobs,
        failedJobs,
        successRate: totalJobs > 0 ? `${Math.round((completedJobs/totalJobs)*100)}%` : 'N/A',
        botDetectionCount,
        botDetectionRate: totalJobs > 0 ? `${Math.round((botDetectionCount/totalJobs)*100)}%` : 'N/A',
        proxyEnabled: CONFIG.proxies.length > 0,
        proxyCount: CONFIG.proxies.length,
        maxConcurrent: CONFIG.maxConcurrent,
        stealthMode: 'MAXIMUM',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Download endpoint
app.post('/api/download', async (req, res) => {
    try {
        const { url, formats = ['video', 'audio', 'silent_video'] } = req.body;

        // Validation
        if (!url) {
            return res.status(400).json({ 
                error: 'URL is required',
                example: 'https://www.youtube.com/watch?v=VIDEO_ID'
            });
        }

        if (!validateYouTubeUrl(url)) {
            return res.status(400).json({ 
                error: 'Invalid YouTube URL format',
                received: url.substring(0, 100),
                expected: 'https://www.youtube.com/watch?v=VIDEO_ID'
            });
        }

        if (!Array.isArray(formats) || formats.length === 0) {
            return res.status(400).json({
                error: 'Invalid formats',
                available: ['video', 'audio', 'silent_video']
            });
        }

        // Production warning
        if (process.env.NODE_ENV === 'production' && CONFIG.proxies.length === 0) {
            console.warn('⚠️ WARNING: No residential proxies configured - bot detection risk is HIGH');
        }

        // Concurrent limit check
        if (activeDownloads.size >= CONFIG.maxConcurrent) {
            return res.status(429).json({ 
                error: 'Too many concurrent downloads', 
                active: activeDownloads.size,
                max: CONFIG.maxConcurrent,
                retry_after: 120
            });
        }

        // Rate limiting
        const clientId = req.ip || 'unknown';
        if (!checkRateLimit(clientId)) {
            return res.status(429).json({
                error: 'Rate limit exceeded',
                retry_after: Math.round(CONFIG.sessionDelay / 1000)
            });
        }

        // Create job
        const jobId = generateJobId();
        const job = {
            id: jobId,
            url,
            formats,
            status: 'queued',
            progress: 0,
            createdAt: new Date().toISOString(),
            files: {},
            clientIp: req.ip
        };

        jobs.set(jobId, job);

        // Start processing
        processDownloadJob(jobId);

        res.json({
            job_id: jobId,
            status: 'queued',
            message: 'Download job created successfully',
            formats: formats,
            estimated_time: '60-180 seconds',
            stealth_mode: 'enabled',
            proxy_protection: CONFIG.proxies.length > 0
        });

    } catch (error) {
        console.error('❌ Download endpoint error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: 'Please try again later'
        });
    }
});

// Status check endpoint
app.get('/api/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ 
            error: 'Job not found',
            job_id: jobId
        });
    }

    const response = {
        job_id: jobId,
        status: job.status,
        progress: job.progress,
        created_at: job.createdAt
    };

    if (job.status === 'completed') {
        response.files = job.files;
        response.completed_at = job.completedAt;
        response.download_count = Object.keys(job.files).length;
        
        if (job.videoInfo) {
            response.video_info = job.videoInfo;
        }
    } else if (job.status === 'failed') {
        response.error = job.error;
        response.error_type = job.errorType;
        
        if (job.errorType === 'bot_detection') {
            response.suggestion = 'YouTube detected automated access. Residential proxies are recommended for reliable operation.';
        }
    } else if (job.status === 'processing') {
        response.message = 'Download in progress...';
    }

    res.json(response);
});

// File serving
app.get('/files/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        
        // Security validation
        if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        const filePath = path.join(CONFIG.downloadDir, filename);

        // Check file exists
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ 
                error: 'File not found',
                filename: filename
            });
        }

        // Get file stats
        const stats = await fs.stat(filePath);
        
        // Set appropriate headers
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stats.size);
        
        // Determine content type
        if (filename.includes('.mp4')) {
            res.setHeader('Content-Type', 'video/mp4');
        } else if (filename.includes('.mp3')) {
            res.setHeader('Content-Type', 'audio/mpeg');
        } else if (filename.includes('.m4a')) {
            res.setHeader('Content-Type', 'audio/mp4');
        }

        // Serve file
        res.sendFile(path.resolve(filePath));
        
    } catch (error) {
        console.error('❌ File serving error:', error);
        res.status(500).json({ error: 'Error serving file' });
    }
});

// Jobs listing with statistics
app.get('/api/jobs', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const allJobs = Array.from(jobs.values());
    const jobList = allJobs
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(offset, offset + limit)
        .map(job => ({
            id: job.id,
            status: job.status,
            progress: job.progress,
            created_at: job.createdAt,
            completed_at: job.completedAt,
            error_type: job.errorType,
            formats: job.formats,
            file_count: job.files ? Object.keys(job.files).length : 0,
            url_preview: job.url.substring(0, 50) + '...'
        }));

    const stats = {
        total: allJobs.length,
        active: activeDownloads.size,
        queued: allJobs.filter(j => j.status === 'queued').length,
        processing: allJobs.filter(j => j.status === 'processing').length,
        completed: allJobs.filter(j => j.status === 'completed').length,
        failed: allJobs.filter(j => j.status === 'failed').length,
        bot_detection_failures: allJobs.filter(j => j.errorType === 'bot_detection').length,
        success_rate: allJobs.length > 0 ? Math.round((allJobs.filter(j => j.status === 'completed').length / allJobs.length) * 100) : 0
    };

    res.json({ 
        jobs: jobList,
        statistics: stats,
        pagination: {
            limit,
            offset,
            total: allJobs.length,
            has_more: offset + limit < allJobs.length
        }
    });
});

// Initialize and start server
async function startServer() {
    try {
        await initDirectories();
        
        // Clean old files every 30 minutes
        setInterval(cleanOldFiles, 30 * 60 * 1000);
        
        const PORT = process.env.PORT || CONFIG.port;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log('\n🚀 YouTube Downloader Service Started Successfully!');
            console.log('='.repeat(60));
            console.log(`📡 Server: http://localhost:${PORT}`);
            console.log(`📁 Downloads: ${CONFIG.downloadDir}`);
            console.log(`🔒 Security: Maximum stealth mode ENABLED`);
            console.log(`⚡ Concurrent: ${CONFIG.maxConcurrent} downloads max`);
            console.log(`⏱️ Delays: ${CONFIG.requestDelay}ms request, ${CONFIG.sessionDelay}ms session`);
            console.log(`🧹 Cleanup: Files deleted after ${CONFIG.fileRetentionHours} hours`);
            
            if (CONFIG.proxies.length > 0) {
                console.log(`🔄 Proxies: ${CONFIG.proxies.length} residential proxies configured`);
                console.log(`✅ Bot Protection: MAXIMUM (Production Ready)`);
            } else {
                console.log(`⚠️ Proxies: NONE configured`);
                console.log(`🚨 Bot Protection: MINIMAL (Testing Only)`);
                console.log(`💡 Add PROXY_LIST environment variable for production`);
            }
            
            console.log('='.repeat(60));
            console.log('🎯 API Endpoints:');
            console.log(`   Health: GET  ${PORT === 80 ? 'http://localhost' : `http://localhost:${PORT}`}/health`);
            console.log(`   Download: POST ${PORT === 80 ? 'http://localhost' : `http://localhost:${PORT}`}/api/download`);
            console.log(`   Status: GET  ${PORT === 80 ? 'http://localhost' : `http://localhost:${PORT}`}/api/status/{job_id}`);
            console.log(`   Files: GET   ${PORT === 80 ? 'http://localhost' : `http://localhost:${PORT}`}/files/{filename}`);
            console.log('='.repeat(60));
            console.log('🔗 Ready for N8N integration!');
            console.log('\n');
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    
    // Close all browser sessions
    for (const [sessionId, session] of sessions) {
        try {
            await session.browser.close();
            console.log(`🔒 Closed session: ${sessionId.slice(0, 8)}...`);
        } catch (e) {
            console.error(`❌ Error closing session ${sessionId.slice(0, 8)}...:`, e.message);
        }
    }
    
    console.log('✅ Graceful shutdown complete');
    process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the server
startServer();

module.exports = app;