export const mockExternalProviderModes = new Set(['success', 'artifacts', 'fail', 'missing_video', 'server_error']);

export function normalizeMockExternalMode(mode = 'success') {
  const normalized = String(mode || 'success').trim().toLowerCase();
  return mockExternalProviderModes.has(normalized) ? normalized : 'success';
}

export function buildMockImageToVideoResponse(mode = 'success', timestamp = Date.now()) {
  const normalizedMode = normalizeMockExternalMode(mode);
  if (normalizedMode === 'artifacts') {
    return {
      status: 200,
      body: {
        ok: true,
        artifacts: [
          {
            type: 'video',
            url: 'https://example.com/mock-artifact-video.mp4',
            mime_type: 'video/mp4',
            duration_seconds: 6,
            provider_job_id: `mock-artifact-job-${timestamp}`,
          },
        ],
      },
    };
  }
  if (normalizedMode === 'fail') {
    return {
      status: 200,
      body: {
        ok: false,
        error: 'mock external failure',
      },
    };
  }
  if (normalizedMode === 'missing_video') {
    return {
      status: 200,
      body: {
        ok: true,
        message: 'ok but no usable video',
      },
    };
  }
  if (normalizedMode === 'server_error') {
    return {
      status: 500,
      body: {
        ok: false,
        error: 'mock server error',
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      video_url: 'https://example.com/mock-video.mp4',
      mime_type: 'video/mp4',
      duration_seconds: 5,
      provider_job_id: `mock-job-${timestamp}`,
    },
  };
}

