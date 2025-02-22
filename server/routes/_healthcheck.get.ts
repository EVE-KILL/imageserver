const startTime = new Date();

export default defineEventHandler(() => {
  return {
    uptime: Math.floor(process.uptime()),
    upSince: startTime,
    localTime: new Date(),
    service: {
      name: 'EVE-KILL ImageServer',
      description: 'A simple image server for EVE-Online',
      version: '1.0.0',
    },
    env: {
      nodeEnv: process.env.NODE_ENV,
      nodeVersion: process.version,
      processName: process.title,
    },
  }
})
