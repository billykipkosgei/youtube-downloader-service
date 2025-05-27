# YouTube Downloader Service - API Documentation

## Overview

The YouTube Downloader Service provides a RESTful API for downloading YouTube videos in multiple formats with advanced bot detection avoidance. This service is designed for integration with automation tools like N8N.

## Base URL

```
Production: https://your-domain.railway.app
Local: http://localhost:3000
```

## Authentication

Currently, no authentication is required. For production deployments, consider implementing API key authentication.

## Rate Limiting

- **General API**: 100 requests per 15 minutes per IP
- **Download Endpoint**: 2 requests per minute per IP
- **Concurrent Downloads**: Maximum 2 simultaneous downloads

## Content Types

All API endpoints accept and return `application/json` unless otherwise specified.

---

## Endpoints

### 1. Health Check

Check the service status and statistics.

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "healthy",
  "service": "YouTube Downloader Service",
  "version": "1.0.0",
  "activeJobs": 2,
  "totalJobs": 150,
  "completedJobs": 142,
  "failedJobs": 8,
  "successRate": "95%",
  "botDetectionCount": 3,
  "botDetectionRate": "2%",
  "proxyEnabled": true,
  "proxyCount": 5,
  "maxConcurrent": 2,
  "stealthMode": "MAXIMUM",
  "timestamp": "2025-05-27T12:30:00.000Z",
  "uptime": 86400
}
```

**Status Codes:**
- `200` - Service is healthy

---

### 2. Start Download

Initiate a download job for a YouTube video.

**Endpoint:** `POST /api/download`

**Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "formats": ["video", "audio", "silent_video"]
}
```

**Parameters:**
- `url` (required): Valid YouTube video URL
- `formats` (optional): Array of formats to download
  - `"video"` - Full video with audio (MP4)
  - `"audio"` - Audio only (MP3)
  - `"silent_video"` - Video without audio (MP4)
  - Default: `["video", "audio", "silent_video"]`

**Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "message": "Download job created successfully",
  "formats": ["video", "audio", "silent_video"],
  "estimated_time": "60-180 seconds",
  "stealth_mode": "enabled",
  "proxy_protection": true
}
```

**Status Codes:**
- `200` - Job created successfully
- `400` - Invalid request (missing URL, invalid format, etc.)
- `429` - Rate limit exceeded or too many concurrent downloads

**Error Response Example:**
```json
{
  "error": "Invalid YouTube URL format",
  "received": "https://invalid-url.com",
  "expected": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

---

### 3. Check Job Status

Get the current status of a download job.

**Endpoint:** `GET /api/status/{job_id}`

**Parameters:**
- `job_id`: The UUID returned from the download endpoint

**Response (Queued/Processing):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "progress": 75,
  "created_at": "2025-05-27T12:30:00.000Z",
  "message": "Download in progress..."
}
```

**Response (Completed):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": 100,
  "created_at": "2025-05-27T12:30:00.000Z",
  "completed_at": "2025-05-27T12:32:15.000Z",
  "download_count": 3,
  "files": {
    "video": "/files/550e8400-e29b-41d4-a716-446655440000_22.mp4",
    "audio": "/files/550e8400-e29b-41d4-a716-446655440000_140.mp3",
    "silent_video": "/files/550e8400-e29b-41d4-a716-446655440000_silent.mp4"
  },
  "video_info": {
    "title": "Never Gonna Give You Up",
    "duration": "3:32",
    "views": "1.4B views",
    "extractedAt": "2025-05-27T12:31:00.000Z"
  }
}
```

**Response (Failed):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "progress": 45,
  "created_at": "2025-05-27T12:30:00.000Z",
  "error": "YouTube bot detection triggered",
  "error_type": "bot_detection",
  "suggestion": "YouTube detected automated access. Residential proxies are recommended for reliable operation."
}
```

**Job Status Values:**
- `queued` - Job is waiting to start
- `processing` - Download in progress
- `completed` - Download finished successfully
- `failed` - Download failed with error

**Error Types:**
- `bot_detection` - YouTube detected automated access
- `general_error` - Other technical errors

**Status Codes:**
- `200` - Job found and status returned
- `404` - Job ID not found

---

### 4. Download Files

Download the processed video/audio files.

**Endpoint:** `GET /files/{filename}`

**Parameters:**
- `filename`: The filename from the job status response

**Response:**
- Binary file content with appropriate headers
- `Content-Type`: `video/mp4`, `audio/mpeg`, or `audio/mp4`
- `Content-Disposition`: `attachment; filename="..."`
- `Content-Length`: File size in bytes

**Status Codes:**
- `200` - File served successfully
- `404` - File not found
- `400` - Invalid filename

**Example Usage:**
```bash
# Download video file
curl -O https://your-domain.com/files/550e8400-e29b-41d4-a716-446655440000_22.mp4

# Download audio file
curl -O https://your-domain.com/files/550e8400-e29b-41d4-a716-446655440000_140.mp3
```

---

### 5. List Jobs

Get a list of recent jobs with statistics.

**Endpoint:** `GET /api/jobs`

**Query Parameters:**
- `limit` (optional): Number of jobs to return (default: 20, max: 100)
- `offset` (optional): Number of jobs to skip (default: 0)

**Response:**
```json
{
  "jobs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "completed",
      "progress": 100,
      "created_at": "2025-05-27T12:30:00.000Z",
      "completed_at": "2025-05-27T12:32:15.000Z",
      "error_type": null,
      "formats": ["video", "audio"],
      "file_count": 2,
      "url_preview": "https://www.youtube.com/watch?v=dQw4w9WgXcQ..."
    }
  ],
  "statistics": {
    "total": 150,
    "active": 2,
    "queued": 1,
    "processing": 1,
    "completed": 142,
    "failed": 8,
    "bot_detection_failures": 3,
    "success_rate": 95
  },
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 150,
    "has_more": true
  }
}
```

**Status Codes:**
- `200` - Jobs retrieved successfully

---

## Error Handling

All API endpoints return consistent error responses:

```json
{
  "error": "Error description",
  "message": "Additional context (optional)",
  "code": "ERROR_CODE (optional)"
}
```

### Common Error Codes

- `400` - Bad Request: Invalid input parameters
- `404` - Not Found: Resource doesn't exist
- `429` - Too Many Requests: Rate limit exceeded
- `500` - Internal Server Error: Unexpected server error

### Bot Detection Handling

When YouTube detects bot activity:

```json
{
  "status": "failed",
  "error": "YouTube bot detection triggered",
  "error_type": "bot_detection",
  "suggestion": "YouTube detected automated access. Residential proxies are recommended for reliable operation."
}
```

**Mitigation Strategies:**
1. Use residential proxies (strongly recommended)
2. Reduce request frequency
3. Wait before retrying (exponential backoff)
4. Monitor success rates via `/health` endpoint

---

## Usage Examples

### Basic Download Workflow

```javascript
// 1. Start download
const downloadResponse = await fetch('https://your-domain.com/api/download', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    formats: ['video', 'audio']
  })
});

const { job_id } = await downloadResponse.json();

// 2. Poll status until completion
let status = 'queued';
while (status === 'queued' || status === 'processing') {
  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
  
  const statusResponse = await fetch(`https://your-domain.com/api/status/${job_id}`);
  const statusData = await statusResponse.json();
  status = statusData.status;
  
  console.log(`Status: ${status} (${statusData.progress}%)`);
}

// 3. Download files if completed
if (status === 'completed') {
  const finalStatus = await fetch(`https://your-domain.com/api/status/${job_id}`);
  const { files } = await finalStatus.json();
  
  // Download video file
  if (files.video) {
    const videoResponse = await fetch(`https://your-domain.com${files.video}`);
    const videoBlob = await videoResponse.blob();
    // Handle video file...
  }
}
```

### N8N Integration Example

**HTTP Request Node (Start Download):**
```json
{
  "method": "POST",
  "url": "https://your-domain.com/api/download",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "url": "{{$node['YouTube URLs'].json['url']}}",
    "formats": ["video", "audio", "silent_video"]
  }
}
```

**Function Node (Status Polling):**
```javascript
const jobId = $input.first().json.job_id;
const baseUrl = "https://your-domain.com";

// Poll status with timeout
let attempts = 0;
const maxAttempts = 36; // 3 minutes max (36 * 5 seconds)

while (attempts < maxAttempts) {
  const response = await $http.request({
    method: 'GET',
    url: `${baseUrl}/api/status/${jobId}`
  });
  
  if (response.status === 'completed') {
    return [{ json: response }];
  } else if (response.status === 'failed') {
    throw new Error(`Download failed: ${response.error}`);
  }
  
  // Wait 5 seconds before next check
  await new Promise(resolve => setTimeout(resolve, 5000));
  attempts++;
}

throw new Error('Download timeout after 3 minutes');
```

---

## Rate Limits & Best Practices

### Rate Limits
- **API Calls**: 100 requests per 15 minutes per IP
- **Downloads**: 2 download requests per minute per IP
- **Concurrent**: Maximum 2 simultaneous downloads

### Best Practices

1. **Always check health before starting**:
   ```bash
   curl https://your-domain.com/health
   ```

2. **Use appropriate polling intervals**:
   - Poll status every 5-10 seconds
   - Don't poll more frequently than every 3 seconds

3. **Handle errors gracefully**:
   - Implement exponential backoff for bot detection
   - Check error_type for specific handling

4. **Monitor success rates**:
   - Use `/health` endpoint to monitor bot detection rates
   - Success rate below 80% indicates proxy issues

5. **File management**:
   - Download files promptly (12-hour retention)
   - Files are automatically cleaned up

---

## Webhook Support (Coming Soon)

Future versions will support webhooks for job completion notifications:

```json
{
  "webhook_url": "https://your-app.com/webhook",
  "events": ["completed", "failed"]
}
```

---

## Support & Troubleshooting

### Common Issues

**High failure rate (>20%)**:
- Configure residential proxies
- Check proxy rotation
- Monitor `/health` for bot detection rate

**Slow downloads**:
- Normal: 60-180 seconds per video
- Delays are intentional for stealth

**Files not found**:
- Files expire after 12 hours
- Check job status for exact filenames

### Monitoring

Use the `/health` endpoint to monitor:
- Success rates
- Bot detection frequency
- Active job counts
- Proxy status

### Contact

For technical support and questions:
- Check service logs for detailed error information
- Monitor `/health` endpoint for service statistics
- Ensure residential proxies are properly configured