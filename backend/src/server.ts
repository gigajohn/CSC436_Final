import { app } from './app.js';

const PORT = Number(process.env.PORT) || 4000;

app.listen(PORT, () => {
  console.log(`[StudySync Backend] Server running on http://localhost:${PORT}`);
  console.log(`[StudySync Backend] Health check ready at http://localhost:${PORT}/healthz`);
  console.log(`[StudySync Backend] Real-time SSE stream ready at http://localhost:${PORT}/api/v1/events/stream`);
});

export default app;
