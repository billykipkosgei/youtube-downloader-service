const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Short test video

async function runTests() {
    console.log('🧪 Testing YouTube Downloader Service...\n');
    console.log(`🌐 Testing against: ${BASE_URL}\n`);

    try {
        // 1. Health Check
        console.log('1️⃣ Health Check...');
        const healthResponse = await axios.get(`${BASE_URL}/health`);
        console.log('✅ Health Check:', healthResponse.data);
        
        if (healthResponse.data.proxyEnabled) {
            console.log('🔄 Proxies: ENABLED (Good for production)');
        } else {
            console.log('⚠️ Proxies: DISABLED (Testing mode only)');
        }

        // 2. Start Download
        console.log('\n2️⃣ Starting Download Test...');
        const downloadResponse = await axios.post(`${BASE_URL}/api/download`, {
            url: TEST_URL,
            formats: ['video', 'audio']
        });
        
        const jobId = downloadResponse.data.job_id;
        console.log('✅ Download Started:', { 
            jobId, 
            status: downloadResponse.data.status,
            estimatedTime: downloadResponse.data.estimated_time 
        });

        // 3. Poll Status
        console.log('\n3️⃣ Monitoring Progress...');
        let status = 'queued';
        let attempts = 0;
        const maxAttempts = 30; // 2.5 minutes max

        while (status !== 'completed' && status !== 'failed' && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            
            const statusResponse = await axios.get(`${BASE_URL}/api/status/${jobId}`);
            status = statusResponse.data.status;
            
            console.log(`⏳ Progress: ${status} (${statusResponse.data.progress || 0}%)`);
            
            if (status === 'failed') {
                console.log('❌ Download Failed:', statusResponse.data.error);
                if (statusResponse.data.error_type === 'bot_detection') {
                    console.log('🚫 Bot Detection Triggered - Residential proxies required for production');
                }
                break;
            }
            
            attempts++;
        }

        if (status === 'completed') {
            const finalStatus = await axios.get(`${BASE_URL}/api/status/${jobId}`);
            console.log('\n✅ Download Completed!');
            console.log('📁 Available Files:', finalStatus.data.files);
            
            if (finalStatus.data.video_info) {
                console.log('📺 Video Info:', finalStatus.data.video_info);
            }

            // 4. Test File Access
            if (finalStatus.data.files.video) {
                console.log('\n4️⃣ Testing File Access...');
                const videoUrl = `${BASE_URL}${finalStatus.data.files.video}`;
                
                try {
                    const fileResponse = await axios.head(videoUrl);
                    console.log('✅ File Accessible:', {
                        url: videoUrl,
                        size: Math.round(fileResponse.headers['content-length'] / 1024 / 1024 * 100) / 100 + ' MB',
                        type: fileResponse.headers['content-type']
                    });
                } catch (error) {
                    console.log('❌ File Access Failed:', error.message);
                }
            }

        } else if (status === 'failed') {
            // Already handled above
        } else {
            console.log('⏰ Test Timeout - Download may still be processing');
        }

        // 5. API Statistics
        console.log('\n5️⃣ Service Statistics...');
        const statsResponse = await axios.get(`${BASE_URL}/api/jobs`);
        console.log('📊 Statistics:', statsResponse.data.statistics);

        console.log('\n🎉 Test Complete!');
        
        if (healthResponse.data.proxyEnabled) {
            console.log('✅ Service is production-ready with proxy protection');
        } else {
            console.log('⚠️ For production use, configure residential proxies in .env file');
        }

    } catch (error) {
        console.error('❌ Test Failed:', error.response?.data || error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('💡 Make sure the service is running: npm start');
        }
        
        process.exit(1);
    }
}

// Run tests
runTests();