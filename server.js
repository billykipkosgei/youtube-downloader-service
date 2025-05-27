const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

// Utility functions
const generateJobId = () => crypto.randomUUID();
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomElement = (array) => array[Math.floor(Math.random() * array.length)];
const getRandomUserAgent = () => getRandomElement(CONFIG.userAgents);
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

// Enhanced yt-dlp download with fixed command building
async function downloadWithYtDlp(url, jobId, formats, sessionId) {
    const userAgent = getRandomUserAgent();
    const proxy = getRandomProxy();
    const outputTemplate = path.join(CONFIG.downloadDir, `${jobId}_%(format_id)s.%(ext)s`);
    
    console.log(`⬇️ Starting yt-dlp download: ${jobId.slice(0, 8)}...`);
    
    const results = {};
    
    // Download video format
    if (formats.includes('video')) {
        console.log('📹 Downloading video...');
        try {
            // Build arguments array properly to avoid shell escaping issues
            const videoArgs = [
                '--no-warnings',
                '--no-cache-dir',
                '--user-agent', userAgent,
                '--referer', 'https://www.youtube.com/',
                '--add-header', `Accept-Language:${getRandomLanguage()}`,
                '--add-header', 'Accept-Encoding:gzip, deflate, br',
                '--add-header', 'Connection:keep-alive',
                '--sleep-interval', '5',
                '--max-sleep-interval', '15',
                '--retries', '3',
                '--fragment-retries', '3',
                '--retry-sleep', 'exp=1:5',
                '-o', outputTemplate,
                '-f', 'best[ext=mp4][height<=1080]/best[ext=mp4]/best',
                '--embed-subs'
            ];

            if (proxy) {
                videoArgs.push('--proxy', proxy);
            }

            videoArgs.push(url);
            
            await execYtDlp(videoArgs);
            
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
            const audioArgs = [
                '--no-warnings',
                '--no-cache-dir',
                '--user-agent', userAgent,
                '--referer', 'https://www.youtube.com/',
                '--add-header', `Accept-Language:${getRandomLanguage()}`,
                '--add-header', 'Accept-Encoding:gzip, deflate, br',
                '--add-header', 'Connection:keep-alive',
                '--sleep-interval', '5',
                '--max-sleep-interval', '15',
                '--retries', '3',
                '--fragment-retries', '3',
                '--retry-sleep', 'exp=1:5',
                '-o', outputTemplate,
                '-f', 'bestaudio[ext=m4a]/bestaudio',
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '192K'
            ];

            if (proxy) {
                audioArgs.push('--proxy', proxy);
            }

            audioArgs.push(url);
            
            await execYtDlp(audioArgs);
            
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
            
            await execFfmpeg([
                '-i', originalVideoPath,
                '-an',
                '-c:v', 'copy',
                '-avoid_negative_ts', 'make_zero',
                silentVideoPath
            ]);
            
            results.silent_video = `/files/${jobId}_silent.mp4`;
            console.log(`✅ Silent video created`);
        } catch (error) {
            console.error('❌ Silent video creation failed:', error.message);
        }
    }

    return results;
}

// Execute yt-dlp with proper process spawning
function execYtDlp(args) {
    return new Promise((resolve, reject) => {
        console.log(`🔧 Executing yt-dlp with ${args.length} arguments`);
        
        const process = spawn('yt-dlp', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 300000 // 5 minute timeout
        });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                // Check for specific YouTube blocking patterns
                if (stderr.includes('Sign in to confirm') || 
                    stderr.includes('bot') || 
                    stderr.includes('429') ||
                    stderr.includes('403')) {
                    reject(new Error(`YouTube bot detection triggered: ${stderr}`));
                } else {
                    reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
                }
            }
        });

        process.on('error', (error) => {
            reject(new Error(`Failed to start yt-dlp: ${error.message}`));
        });
    });
}

// Execute ffmpeg with proper process spawning
function execFfmpeg(args) {
    return new Promise((resolve, reject) => {
        console.log(`🔧 Executing ffmpeg with ${args.length} arguments`);
        
        const process = spawn('ffmpeg', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 180000 // 3 minute timeout
        });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`ffmpeg failed with code ${code}: ${stderr}`));
            }
        });

        process.on('error', (error) => {
            reject(new Error(`Failed to start ffmpeg: ${error.message}`));
        });
    });
}

// Process download job (simplified without browser automation for Railway)
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

        job.progress = 50;

        // Download files using yt-dlp directly (skip browser for Railway compatibility)
        const downloadResults = await downloadWithYtDlp(job.url, jobId, job.formats, sessionId);
        
        if (Object.keys(downloadResults).length === 0) {
            throw new Error('No files downloaded - possible bot detection or video unavailable');
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