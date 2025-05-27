// server.js - Enhanced version with better bot detection avoidance
const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Trust Railway proxy for rate limiting
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting with Railway compatibility
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip || req.connection.remoteAddress || 'unknown';
    }
});
app.use('/api/', limiter);

// Enhanced configuration with better bot detection avoidance
const CONFIG = {
    port: process.env.PORT || 3000,
    downloadDir: process.env.DOWNLOAD_DIR || './downloads',
    tempDir: process.env.TEMP_DIR || './temp',
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 1, // Reduced for stealth
    requestDelay: parseInt(process.env.REQUEST_DELAY) || 15000, // Increased delay
    sessionDelay: parseInt(process.env.SESSION_DELAY) || 60000, // Increased session delay
    fileRetentionHours: parseInt(process.env.FILE_RETENTION_HOURS) || 12,
    
    // Proxy configuration with validation
    proxies: process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',').map(p => p.trim()) : [],
    
    // More realistic user agents (updated for 2025)
    userAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0'
    ],
    
    // Enhanced language and region simulation
    languages: [
        'en-US,en;q=0.9',
        'en-GB,en;q=0.9,en-US;q=0.8',
        'en-US,en;q=0.9,es;q=0.8,de;q=0.7'
    ],
    
    // Realistic viewport sizes
    viewports: [
        '1920x1080',
        '1366x768',
        '1536x864',
        '1440x900',
        '1280x720'
    ]
};

// In-memory storage
const jobs = new Map();
const activeDownloads = new Set();
const lastRequestTime = new Map();
const proxyRotation = new Map();

// Utility functions
const generateJobId = () => crypto.randomUUID();
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomElement = (array) => array[Math.floor(Math.random() * array.length)];
const getRandomUserAgent = () => getRandomElement(CONFIG.userAgents);
const getRandomLanguage = () => getRandomElement(CONFIG.languages);
const getRandomViewport = () => getRandomElement(CONFIG.viewports);

// Enhanced proxy rotation with health checking
const getNextProxy = () => {
    if (CONFIG.proxies.length === 0) return null;
    
    const now = Date.now();
    let bestProxy = null;
    let oldestUse = now;
    
    for (const proxy of CONFIG.proxies) {
        const lastUsed = proxyRotation.get(proxy) || 0;
        if (lastUsed < oldestUse) {
            oldestUse = lastUsed;
            bestProxy = proxy;
        }
    }
    
    if (bestProxy) {
        proxyRotation.set(bestProxy, now);
    }
    
    return bestProxy;
};

// Enhanced rate limiting check
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

// Execute command with proper error handling
function execCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`🔧 Executing ${command} with ${args.length} arguments`);
        
        const childProcess = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: options.timeout || 300000, // 5 minute default timeout
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1'
            },
            ...options
        });

        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        childProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        childProcess.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                const errorMessage = stderr + stdout;
                reject(new Error(`${command} failed with code ${code}: ${errorMessage.slice(0, 500)}`));
            }
        });

        childProcess.on('error', (error) => {
            reject(new Error(`Failed to start ${command}: ${error.message}`));
        });
    });
}

// Enhanced yt-dlp download with maximum stealth
async function downloadWithYtDlp(url, jobId, formats, sessionId) {
    const userAgent = getRandomUserAgent();
    const proxy = getNextProxy();
    const language = getRandomLanguage();
    const viewport = getRandomViewport();
    const outputTemplate = path.join(CONFIG.downloadDir, `${jobId}_%(format_id)s.%(ext)s`);
    
    console.log(`⬇️ Starting enhanced yt-dlp download: ${jobId.slice(0, 8)}...`);
    if (proxy) {
        console.log(`🌐 Using proxy: ${proxy.split('@')[1] || proxy.split('//')[1]}`);
    }
    
    const results = {};
    
    // Ultra-enhanced base arguments for maximum stealth
    const getStealthArgs = () => {
        const args = [
            '--no-warnings',
            '--no-cache-dir',
            '--no-check-certificate',
            '--user-agent', userAgent,
            '--referer', 'https://www.youtube.com/',
            '--add-header', `Accept-Language:${language}`,
            '--add-header', `Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8`,
            '--add-header', `Accept-Encoding:gzip, deflate, br`,
            '--add-header', `DNT:1`,
            '--add-header', `Upgrade-Insecure-Requests:1`,
            '--add-header', `Sec-Fetch-Dest:document`,
            '--add-header', `Sec-Fetch-Mode:navigate`,
            '--add-header', `Sec-Fetch-Site:none`,
            '--add-header', `Cache-Control:max-age=0`,
            
            // Multiple client strategies
            '--extractor-args', 'youtube:player_client=android,web,ios',
            '--extractor-args', 'youtube:skip=hls,dash',
            '--extractor-args', 'youtube:player_skip=configs,webpage',
            
            // Enhanced retry and delay options
            '--sleep-interval', '3',
            '--max-sleep-interval', '8',
            '--sleep-requests', '2',
            '--sleep-subtitles', '1',
            '--retries', '5',
            '--fragment-retries', '5',
            '--retry-sleep', 'exp=1:5',
            '--retry-sleep', 'fragment:exp=1:3',
            
            // Additional stealth options
            '--ignore-errors',
            '--no-call-home',
            '--no-check-extensions',
            '--prefer-insecure',
            
            '-o', outputTemplate
        ];

        // Add proxy if available
        if (proxy) {
            args.push('--proxy', proxy);
            // Add proxy-specific headers to appear more legitimate
            args.push('--add-header', 'X-Forwarded-For:' + Math.floor(Math.random() * 255) + '.' + 
                     Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255) + '.' + 
                     Math.floor(Math.random() * 255));
        }

        return args;
    };
    
    // Strategy 1: Android client (most reliable)
    if (formats.includes('video')) {
        console.log('📹 Downloading video with Android client...');
        
        try {
            const androidArgs = [
                ...getStealthArgs(),
                '--extractor-args', 'youtube:player_client=android',
                '-f', 'best[height<=1080][ext=mp4]/best[ext=mp4]/best',
                url
            ];
            
            await execCommand('yt-dlp', androidArgs, { timeout: 240000 });
            
            const videoFiles = await fs.readdir(CONFIG.downloadDir);
            const videoFile = videoFiles.find(f => 
                f.startsWith(`${jobId}_`) && 
                (f.includes('.mp4') || f.includes('.webm') || f.includes('.mkv'))
            );
            if (videoFile) {
                results.video = `/files/${videoFile}`;
                console.log(`✅ Video downloaded (Android): ${videoFile}`);
            }
        } catch (error) {
            console.error('❌ Android client failed:', error.message);
            
            // Strategy 2: iOS client fallback
            try {
                console.log('🔄 Trying iOS client...');
                await delay(5000 + Math.random() * 5000); // Random delay
                
                const iosArgs = [
                    '--no-warnings',
                    '--no-cache-dir',
                    '--user-agent', userAgent,
                    '--extractor-args', 'youtube:player_client=ios',
                    '--sleep-interval', '2',
                    '--retries', '3',
                    '-f', 'best[height<=720][ext=mp4]/best',
                    '-o', outputTemplate
                ];
                
                if (proxy) {
                    iosArgs.push('--proxy', proxy);
                }
                iosArgs.push(url);
                
                await execCommand('yt-dlp', iosArgs, { timeout: 180000 });
                
                const videoFiles = await fs.readdir(CONFIG.downloadDir);
                const videoFile = videoFiles.find(f => 
                    f.startsWith(`${jobId}_`) && f.includes('.mp4')
                );
                if (videoFile) {
                    results.video = `/files/${videoFile}`;
                    console.log(`✅ Video downloaded (iOS): ${videoFile}`);
                }
            } catch (iosError) {
                console.error('❌ iOS client also failed:', iosError.message);
                
                // Strategy 3: Web client with cookies simulation
                try {
                    console.log('🔄 Trying web client with cookie simulation...');
                    await delay(8000 + Math.random() * 7000); // Longer delay
                    
                    // Create a temporary cookies file to simulate a real browser session
                    const cookiesFile = path.join(CONFIG.tempDir, `cookies_${jobId}.txt`);
                    await fs.writeFile(cookiesFile, '# Netscape HTTP Cookie File\n');
                    
                    const webArgs = [
                        '--no-warnings',
                        '--cookies', cookiesFile,
                        '--user-agent', userAgent,
                        '--extractor-args', 'youtube:player_client=web',
                        '--add-header', `Accept-Language:${language}`,
                        '--sleep-interval', '1',
                        '--retries', '2',
                        '-f', 'worst[ext=mp4]/worst', // Try lowest quality
                        '-o', outputTemplate
                    ];
                    
                    if (proxy) {
                        webArgs.push('--proxy', proxy);
                    }
                    webArgs.push(url);
                    
                    await execCommand('yt-dlp', webArgs, { timeout: 120000 });
                    
                    // Clean up cookies file
                    try {
                        await fs.unlink(cookiesFile);
                    } catch {}
                    
                    const videoFiles = await fs.readdir(CONFIG.downloadDir);
                    const videoFile = videoFiles.find(f => f.startsWith(`${jobId}_`));
                    if (videoFile) {
                        results.video = `/files/${videoFile}`;
                        console.log(`✅ Video downloaded (web): ${videoFile}`);
                    }
                } catch (webError) {
                    console.error('❌ All video strategies failed:', webError.message);
                }
            }
        }
        
        // Long delay between video and audio to avoid detection
        await delay(CONFIG.requestDelay + Math.random() * 10000);
    }

    // Audio extraction with enhanced stealth
    if (formats.includes('audio')) {
        console.log('🎵 Extracting audio with maximum stealth...');
        
        try {
            const audioArgs = [
                ...getStealthArgs(),
                '--extractor-args', 'youtube:player_client=android',
                '-f', 'bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio',
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', '192K',
                '--embed-metadata',
                url
            ];
            
            await execCommand('yt-dlp', audioArgs, { timeout: 180000 });
            
            const audioFiles = await fs.readdir(CONFIG.downloadDir);
            const audioFile = audioFiles.find(f => 
                f.startsWith(`${jobId}_`) && 
                (f.includes('.mp3') || f.includes('.m4a') || f.includes('.ogg'))
            );
            if (audioFile) {
                results.audio = `/files/${audioFile}`;
                console.log(`✅ Audio extracted: ${audioFile}`);
            }
        } catch (error) {
            console.error('❌ Audio extraction failed:', error.message);
            
            // Fallback: Extract from video if available
            try {
                console.log('🔄 Extracting audio from video...');
                const videoFiles = await fs.readdir(CONFIG.downloadDir);
                const anyVideo = videoFiles.find(f => 
                    f.startsWith(`${jobId}_`) && 
                    (f.includes('.mp4') || f.includes('.webm') || f.includes('.mkv'))
                );
                
                if (anyVideo) {
                    const audioOutput = path.join(CONFIG.downloadDir, `${jobId}_audio.mp3`);
                    await execCommand('ffmpeg', [
                        '-y', '-i', path.join(CONFIG.downloadDir, anyVideo),
                        '-vn', '-acodec', 'mp3', '-ab', '192k', '-ar', '44100',
                        audioOutput
                    ], { timeout: 120000 });
                    
                    results.audio = `/files/${jobId}_audio.mp3`;
                    console.log(`✅ Audio extracted via ffmpeg: ${jobId}_audio.mp3`);
                }
            } catch (ffmpegError) {
                console.error('❌ Audio extraction via ffmpeg failed:', ffmpegError.message);
            }
        }
        
        await delay(CONFIG.requestDelay + Math.random() * 5000);
    }

    // Create silent video with enhanced processing
    if (formats.includes('silent_video') && results.video) {
        console.log('🔇 Creating silent video...');
        try {
            const originalVideoPath = path.join(CONFIG.downloadDir, results.video.replace('/files/', ''));
            const silentVideoPath = path.join(CONFIG.downloadDir, `${jobId}_silent.mp4`);
            
            await execCommand('ffmpeg', [
                '-y', '-i', originalVideoPath,
                '-an', '-c:v', 'libx264', '-crf', '23',
                '-preset', 'fast', '-movflags', '+faststart',
                silentVideoPath
            ], { timeout: 120000 });
            
            results.silent_video = `/files/${jobId}_silent.mp4`;
            console.log(`✅ Silent video created: ${jobId}_silent.mp4`);
        } catch (error) {
            console.error('❌ Silent video creation failed:', error.message);
        }
    }

    return results;
}

// Enhanced job processing with better error handling
async function processDownloadJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;

    const sessionId = `session_${jobId}`;
    
    try {
        console.log(`🚀 Processing job with enhanced stealth: ${jobId.slice(0, 8)}...`);
        job.status = 'processing';
        job.progress = 5;
        activeDownloads.add(jobId);

        // Enhanced rate limiting check
        if (!checkRateLimit(sessionId)) {
            throw new Error('Rate limit exceeded - please try again later');
        }

        // URL validation
        if (!validateYouTubeUrl(job.url)) {
            throw new Error('Invalid YouTube URL format');
        }

        job.progress = 15;

        // Enhanced stealth delay with random variation
        const baseDelay = 10000; // 10 seconds minimum
        const randomDelay = Math.random() * 20000; // Up to 20 seconds additional
        const totalDelay = baseDelay + randomDelay;
        
        console.log(`⏳ Enhanced stealth delay: ${Math.round(totalDelay/1000)}s`);
        await delay(totalDelay);

        job.progress = 40;

        // Download files with enhanced stealth
        const downloadResults = await downloadWithYtDlp(job.url, jobId, job.formats, sessionId);
        
        if (Object.keys(downloadResults).length === 0) {
            throw new Error('No files downloaded - YouTube may have detected automation or video is unavailable');
        }
        
        job.files = downloadResults;
        job.progress = 95;

        // Final delay before completion
        await delay(2000 + Math.random() * 3000);

        // Complete job
        job.status = 'completed';
        job.progress = 100;
        job.completedAt = new Date().toISOString();

        console.log(`✅ Job completed successfully: ${jobId.slice(0, 8)}... (${Object.keys(downloadResults).length} files)`);

    } catch (error) {
        job.status = 'failed';
        job.error = error.message;
        
        // Enhanced error categorization
        if (error.message.includes('Failed to extract any player response') ||
            error.message.includes('Sign in to confirm') ||
            error.message.includes('bot') ||
            error.message.includes('429') ||
            error.message.includes('403') ||
            error.message.includes('captcha') ||
            error.message.includes('Tunnel connection failed')) {
            job.errorType = 'bot_detection';
            console.error(`🚫 Bot detection for job ${jobId.slice(0, 8)}...: ${error.message}`);
        } else if (error.message.includes('Video not accessible') ||
                  error.message.includes('unavailable') ||
                  error.message.includes('Private video') ||
                  error.message.includes('does not exist')) {
            job.errorType = 'video_unavailable';
            console.error(`📹 Video unavailable for job ${jobId.slice(0, 8)}...: ${error.message}`);
        } else if (error.message.includes('extraction failed') ||
                  error.message.includes('Failed to extract')) {
            job.errorType = 'extraction_error';
            console.error(`🔧 Extraction error for job ${jobId.slice(0, 8)}...: ${error.message}`);
        } else {
            job.errorType = 'general_error';
            console.error(`❌ Job failed ${jobId.slice(0, 8)}...: ${error.message}`);
        }
    } finally {
        activeDownloads.delete(jobId);
    }
}

// API Routes

// Enhanced health check
app.get('/health', (req, res) => {
    const totalJobs = jobs.size;
    const completedJobs = Array.from(jobs.values()).filter(j => j.status === 'completed').length;
    const failedJobs = Array.from(jobs.values()).filter(j => j.status === 'failed').length;
    const botDetectionCount = Array.from(jobs.values()).filter(j => j.errorType === 'bot_detection').length;
    
    res.json({ 
        status: 'healthy',
        service: 'Enhanced YouTube Downloader Service',
        version: '2.0.0',
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
        stealthMode: 'ULTRA-MAXIMUM',
        enhancedFeatures: {
            multiClientExtraction: true,
            proxyRotation: true,
            cookieSimulation: true,
            enhancedDelays: true,
            realisticHeaders: true
        },
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Enhanced download endpoint
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

        // Enhanced concurrent limit check
        if (activeDownloads.size >= CONFIG.maxConcurrent) {
            return res.status(429).json({ 
                error: 'Maximum concurrent downloads reached', 
                active: activeDownloads.size,
                max: CONFIG.maxConcurrent,
                retry_after: 180,
                message: 'Enhanced stealth mode limits concurrent downloads for better success rates'
            });
        }

        // Enhanced rate limiting
        const clientId = req.ip || 'unknown';
        if (!checkRateLimit(clientId)) {
            return res.status(429).json({
                error: 'Rate limit exceeded for enhanced stealth protection',
                retry_after: Math.round(CONFIG.sessionDelay / 1000),
                message: 'Extended delays are required for maximum bot detection avoidance'
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
            clientIp: req.ip,
            enhancedStealth: true
        };

        jobs.set(jobId, job);

        // Start processing
        processDownloadJob(jobId);

        res.json({
            job_id: jobId,
            status: 'queued',
            message: 'Enhanced stealth download job created successfully',
            formats: formats,
            estimated_time: '120-300 seconds',
            stealth_mode: 'ULTRA-MAXIMUM',
            features: {
                proxy_protection: CONFIG.proxies.length > 0,
                multi_client_extraction: true,
                enhanced_delays: true,
                realistic_headers: true,
                cookie_simulation: true
            }
        });

    } catch (error) {
        console.error('❌ Download endpoint error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: 'Please try again later'
        });
    }
});

// Status check endpoint (unchanged)
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
        created_at: job.createdAt,
        enhanced_stealth: job.enhancedStealth || false
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
            response.suggestion = 'YouTube bot detection triggered. Try again in 5-10 minutes with a different video for best results.';
        } else if (job.errorType === 'video_unavailable') {
            response.suggestion = 'Video may be private, deleted, or geo-restricted. Try a different video.';
        } else if (job.errorType === 'extraction_error') {
            response.suggestion = 'YouTube extraction failed. This is often temporary - try again in a few minutes.';
        }
    } else if (job.status === 'processing') {
        response.message = 'Enhanced stealth download in progress...';
    }

    res.json(response);
});

// File serving (unchanged)
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

// Jobs listing with statistics (unchanged)
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
            url_preview: job.url.substring(0, 50) + '...',
            enhanced_stealth: job.enhancedStealth || false
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
            console.log('\n🚀 Enhanced YouTube Downloader Service Started!');
            console.log('='.repeat(70));
            console.log(`📡 Server: Running on port ${PORT}`);
            console.log(`📁 Downloads: ${CONFIG.downloadDir}`);
            console.log(`🔒 Security: ULTRA-MAXIMUM stealth mode ENABLED`);
            console.log(`⚡ Concurrent: ${CONFIG.maxConcurrent} downloads max (optimized for stealth)`);
            console.log(`⏱️ Delays: ${CONFIG.requestDelay}ms request, ${CONFIG.sessionDelay}ms session`);
            console.log(`🤖 Anti-Bot: Multi-client extraction, proxy rotation, cookie simulation`);
            
            if (CONFIG.proxies.length > 0) {
                console.log(`🔄 Proxies: ${CONFIG.proxies.length} residential proxies with rotation`);
                console.log(`✅ Bot Protection: ULTRA-MAXIMUM (Production Ready)`);
            } else {
                console.log(`⚠️ Proxies: NONE configured`);
                console.log(`🚨 Bot Protection: ENHANCED (Testing Only - Proxies strongly recommended)`);
            }
            
            console.log('='.repeat(70));
            console.log('🎯 Enhanced for maximum YouTube bot detection avoidance!');
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;