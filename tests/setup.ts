// Provider keys from the developer's shell must not leak into tests (config falls back to them).
delete process.env.KIE_API_KEY;
delete process.env.ELEVENLABS_API_KEY;
